import express from "express";
import http from "http";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(cookieParser());
app.use(express.json());
app.use(express.static("public"));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// --- Tables ---
await pool.query(`CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  user TEXT,
  message TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
await pool.query(`CREATE TABLE IF NOT EXISTS banned (
  user TEXT PRIMARY KEY,
  cookie TEXT
)`);

// --- Runtime maps ---
const mutedUsers = new Map();
const onlineUsers = new Map(); // socket.id -> username
const lastWhisper = new Map(); // last whisper sender per user

// --- Auth ---
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  try {
    await pool.query("INSERT INTO users(username,password) VALUES($1,$2)", [username, hash]);
    res.json({ success: true });
  } catch {
    res.json({ success: false, msg: "Username taken" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  const result = await pool.query("SELECT * FROM users WHERE username=$1 AND password=$2", [username, hash]);
  if (result.rowCount === 0) return res.json({ success: false, msg: "Invalid credentials" });

  const banned = await pool.query("SELECT * FROM banned WHERE user=$1", [username]);
  if (banned.rowCount > 0) {
    res.cookie("banned", banned.rows[0].cookie, { maxAge: 10 * 365 * 24 * 60 * 60 * 1000 });
    return res.json({ success: false, msg: "You are banned" });
  }

  res.json({ success: true });
});

// --- Socket.IO ---
io.on("connection", (socket) => {
  let username;

  socket.on("registerSocket", async (data) => {
    username = data.username;
    socket.user = username;
    onlineUsers.set(socket.id, username);
    io.emit("online-users", Array.from(onlineUsers.values()));

    // Send last 50 messages
    const messages = await pool.query("SELECT * FROM messages ORDER BY id DESC LIMIT 50");
    socket.emit("chat-history", messages.rows.reverse());
  });

  socket.on("chat", async ({ user, message }) => {
    const banned = await pool.query("SELECT * FROM banned WHERE user=$1", [user]);
    if (banned.rowCount > 0) return socket.disconnect(true);

    if (mutedUsers.has(user) && Date.now() < mutedUsers.get(user)) return;
    if (mutedUsers.has(user)) mutedUsers.delete(user);

    // Admin commands
    if (user === "DEV" && message.startsWith("/")) {
      const parts = message.split(" ");
      const cmd = parts[0];
      const target = parts[1];

      switch (cmd) {
        case "/close":
          io.sockets.sockets.forEach(s => { if (s.user === target) s.disconnect(true); });
          break;
        case "/mute":
          let duration = 60000;
          if (parts[2]) duration = parseInt(parts[2]) * 1000;
          mutedUsers.set(target, Date.now() + duration);
          break;
        case "/ban":
          const cookieValue = `${target}-${Date.now()}`;
          await pool.query("INSERT INTO banned(user,cookie) VALUES($1,$2) ON CONFLICT(user) DO UPDATE SET cookie=$2", [target, cookieValue]);
          io.sockets.sockets.forEach(s => { if (s.user === target) s.disconnect(true); });
          socket.emit("ban-cookie", { user: target, cookie: cookieValue });
          break;
      }
      return;
    }

    // Whisper
    if (message.startsWith("/whisper ")) {
      const parts = message.split(" ");
      const targetUser = parts[1];
      const msg = parts.slice(2).join(" ");
      lastWhisper.set(targetUser, user);
      io.sockets.sockets.forEach(s => {
        if (s.user === targetUser || s.user === user || user === "DEV") {
          s.emit("whisper", { from: user, to: targetUser, message: msg });
        }
      });
      return;
    }

    // Reply
    if (message.startsWith("/reply ")) {
      const msg = message.slice(7);
      const targetUser = lastWhisper.get(user);
      if (!targetUser) return;
      lastWhisper.set(targetUser, user);
      io.sockets.sockets.forEach(s => {
        if (s.user === targetUser || s.user === user || user === "DEV") {
          s.emit("whisper", { from: user, to: targetUser, message: msg });
        }
      });
      return;
    }

    await pool.query("INSERT INTO messages(user,message) VALUES($1,$2)", [user, message]);
    io.emit("chat", { user, message });
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
