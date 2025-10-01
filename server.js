import express from "express";
import http from "http";
import { Server } from "socket.io";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.static("public"));

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    username TEXT,
    message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS banned (
    username TEXT PRIMARY KEY,
    cookie TEXT
  )`);
}

initDb();

// store muted users in memory
const muted = new Map();

io.on("connection", (socket) => {
  let username = null;

  socket.on("register", async (data, cb) => {
    const { username: u, password } = data;
    try {
      await pool.query("INSERT INTO users(username,password) VALUES($1,$2)", [u, password]);
      cb({ success: true });
    } catch (e) {
      cb({ success: false, error: "Username taken" });
    }
  });

  socket.on("login", async (data, cb) => {
    const { username: u, password } = data;
    const res = await pool.query("SELECT * FROM users WHERE username=$1 AND password=$2", [u, password]);
    if (res.rows.length > 0) {
      username = u;

      // check ban
      const banCheck = await pool.query("SELECT * FROM banned WHERE username=$1", [u]);
      if (banCheck.rows.length > 0) {
        cb({ success: false, error: "You are banned." });
        return;
      }

      const messages = await pool.query("SELECT * FROM messages ORDER BY id DESC LIMIT 50");
      cb({ success: true, history: messages.rows.reverse() });

      io.emit("system", `${username} joined`);
    } else {
      cb({ success: false, error: "Invalid credentials" });
    }
  });

  socket.on("chat", async (data) => {
    if (!username) return;
    if (muted.has(username) && Date.now() < muted.get(username)) {
      socket.emit("system", "You are muted.");
      return;
    }

    const { message } = data;

    // --- Commands ---
    if (message.startsWith("/")) {
      const parts = message.split(" ");
      const cmd = parts[0].toLowerCase();

      // admin check
      const isAdmin = username === "DEV";

      if (cmd === "/whisper") {
        const target = parts[1];
        const msg = parts.slice(2).join(" ");
        for (let [id, s] of io.sockets.sockets) {
          if (s.username === target || s.username === username) {
            s.emit("whisper", { from: username, to: target, message: msg });
          }
        }
        return;
      }

      if (cmd === "/reply") {
        const msg = parts.slice(1).join(" ");
        // store last whisper target in memory
        if (socket.lastWhisperFrom) {
          for (let [id, s] of io.sockets.sockets) {
            if (s.username === socket.lastWhisperFrom || s.username === username) {
              s.emit("whisper", { from: username, to: socket.lastWhisperFrom, message: msg });
            }
          }
        } else {
          socket.emit("system", "No whisper to reply to.");
        }
        return;
      }

      if (isAdmin) {
        if (cmd === "/mute") {
          const target = parts[1];
          const time = parseInt(parts[2]) || 60;
          const until = Date.now() + time * 1000;
          muted.set(target, until);
          io.emit("system", `${target} muted for ${time}s by admin.`);
          return;
        }

        if (cmd === "/ban") {
          const target = parts[1];
          await pool.query("INSERT INTO banned(username,cookie) VALUES($1,$2) ON CONFLICT(username) DO UPDATE SET cookie=$2", [target, "blocked"]);
          io.emit("system", `${target} was banned.`);
          return;
        }

        if (cmd === "/close") {
          const target = parts[1];
          for (let [id, s] of io.sockets.sockets) {
            if (s.username === target) {
              s.emit("force-close");
              s.disconnect(true);
            }
          }
          io.emit("system", `${target}'s chat was closed by admin.`);
          return;
        }
      }
      return;
    }

    // Normal message
    await pool.query("INSERT INTO messages(username,message) VALUES($1,$2)", [username, message]);
    io.emit("chat", { username, message });
  });

  socket.on("disconnect", () => {
    if (username) io.emit("system", `${username} left`);
  });

  socket.username = username;
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
