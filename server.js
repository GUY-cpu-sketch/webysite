import express from "express";
import http from "http";
import { Server } from "socket.io";
import Database from "better-sqlite3";
import cookieParser from "cookie-parser";

// --- Config ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(cookieParser());
app.use(express.static("public"));

const dbPath = process.env.RENDER ? "/opt/render/data/chat.db" : "chat.db";
const db = new Database(dbPath);

// --- DB Setup ---
db.prepare(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS banned (
    user TEXT PRIMARY KEY,
    cookie TEXT
  )
`).run();

// --- In-memory muted users ---
const mutedUsers = new Map(); // user -> timestamp when mute ends

// --- Socket.IO ---
io.on("connection", (socket) => {
  console.log("User connected");

  // Send chat history
  const messages = db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT 50").all();
  socket.emit("chat-history", messages.reverse());

  // Handle messages
  socket.on("chat", (data) => {
    const { user, message } = data;

    // Check if banned
    if (socket.handshake.headers.cookie) {
      const cookies = Object.fromEntries(socket.handshake.headers.cookie.split("; ").map(c => c.split("=")));
      if (cookies.banned && cookies.banned === user) return;
    }

    // Check if muted
    if (mutedUsers.has(user)) {
      const muteEnd = mutedUsers.get(user);
      if (Date.now() < muteEnd) return;
      else mutedUsers.delete(user);
    }

    // Admin commands
    if (user === "DEV" && message.startsWith("/")) {
      const parts = message.split(" ");
      const cmd = parts[0];
      const target = parts[1];

      switch (cmd) {
        case "/close":
          io.sockets.sockets.forEach((s) => {
            if (s.id === target || s.user === target) s.disconnect(true);
          });
          break;
        case "/mute":
          let duration = 60000; // default 60s
          if (parts[2]) duration = parseInt(parts[2]) * 1000;
          mutedUsers.set(target, Date.now() + duration);
          break;
        case "/ban":
          const cookieValue = `${target}-${Date.now()}`;
          db.prepare("INSERT OR REPLACE INTO banned (user, cookie) VALUES (?, ?)").run(target, cookieValue);
          io.sockets.sockets.forEach((s) => {
            if (s.user === target) s.disconnect(true);
          });
          break;
      }
      return; // Don't broadcast admin command
    }

    // Normal message
    db.prepare("INSERT INTO messages (user, message) VALUES (?, ?)").run(user, message);
    socket.user = user;
    io.emit("chat", { user, message });
  });

  socket.on("disconnect", () => console.log("User disconnected"));
});

// --- Start server ---
server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
