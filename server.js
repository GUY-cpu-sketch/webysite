import express from "express";
import http from "http";
import { Server } from "socket.io";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

// --- PostgreSQL connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Create table if not exists ---
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      is_admin BOOLEAN DEFAULT false
    );
  `);
})();

// --- In-memory state for whispers ---
const onlineUsers = {}; // socket.id → username
const lastWhispers = {}; // username → last sender

// --- Register endpoint ---
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2)",
      [username, password]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Register error:", err);
    res.json({ success: false, error: "Username already taken" });
  }
});

// --- Login endpoint ---
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username=$1 AND password=$2",
      [username, password]
    );
    if (result.rows.length > 0) {
      res.json({ success: true, isAdmin: result.rows[0].is_admin });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.json({ success: false });
  }
});

// --- Socket.io chat ---
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("login", (username) => {
    onlineUsers[socket.id] = username;
    io.emit("system", `${username} joined the chat`);
  });

  socket.on("chat", (msg) => {
    const username = onlineUsers[socket.id] || "Unknown";
    if (!msg.startsWith("/")) {
      io.emit("chat", { user: username, message: msg, whisper: false });
      return;
    }

    // --- Handle commands ---
    const parts = msg.split(" ");
    const command = parts[0].toLowerCase();

    if (command === "/whisper" && parts.length >= 3) {
      const targetUser = parts[1];
      const whisperMsg = parts.slice(2).join(" ");

      // find target socket
      const targetSocketId = Object.keys(onlineUsers).find(
        (id) => onlineUsers[id] === targetUser
      );

      if (targetSocketId) {
        // send to sender + target
        socket.emit("chat", {
          user: username,
          message: `(whisper to ${targetUser}) ${whisperMsg}`,
          whisper: true,
        });
        io.to(targetSocketId).emit("chat", {
          user: username,
          message: `(whisper) ${whisperMsg}`,
          whisper: true,
        });

        // record last whisper
        lastWhispers[targetUser] = username;
        lastWhispers[username] = targetUser;

        // broadcast to admins (snoop mode)
        for (const [id, user] of Object.entries(onlineUsers)) {
          pool.query("SELECT is_admin FROM users WHERE username=$1", [user])
            .then((result) => {
              if (result.rows.length > 0 && result.rows[0].is_admin) {
                io.to(id).emit("chat", {
                  user: username,
                  message: `(whisper to ${targetUser}) ${whisperMsg}`,
                  whisper: true,
                });
              }
            });
        }
      } else {
        socket.emit("chat", {
          user: "SYSTEM",
          message: `User ${targetUser} not found.`,
          whisper: true,
        });
      }
    } else if (command === "/reply" && parts.length >= 2) {
      const replyMsg = parts.slice(1).join(" ");
      const lastUser = lastWhispers[username];

      if (lastUser) {
        const targetSocketId = Object.keys(onlineUsers).find(
          (id) => onlineUsers[id] === lastUser
        );

        if (targetSocketId) {
          socket.emit("chat", {
            user: username,
            message: `(reply to ${lastUser}) ${replyMsg}`,
            whisper: true,
          });
          io.to(targetSocketId).emit("chat", {
            user: username,
            message: `(reply) ${replyMsg}`,
            whisper: true,
          });

          // broadcast to admins
          for (const [id, user] of Object.entries(onlineUsers)) {
            pool.query("SELECT is_admin FROM users WHERE username=$1", [user])
              .then((result) => {
                if (result.rows.length > 0 && result.rows[0].is_admin) {
                  io.to(id).emit("chat", {
                    user: username,
                    message: `(reply to ${lastUser}) ${replyMsg}`,
                    whisper: true,
                  });
                }
              });
          }
        }
      } else {
        socket.emit("chat", {
          user: "SYSTEM",
          message: "No recent whisper to reply to.",
          whisper: true,
        });
      }
    }
  });

  socket.on("disconnect", () => {
    const username = onlineUsers[socket.id];
    if (username) {
      io.emit("system", `${username} left the chat`);
      delete onlineUsers[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
