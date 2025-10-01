import express from "express";
import http from "http";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import cookieParser from "cookie-parser";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(cookieParser());
app.use(express.json());
app.use(express.static("public"));

const dbFile = process.env.RENDER ? "/opt/render/data/chat.db" : "chat.db";
const db = await open({
  filename: dbFile,
  driver: sqlite3.Database
});

// --- Tables ---
await db.run(`CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT
)`);
await db.run(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT,
  message TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
await db.run(`CREATE TABLE IF NOT EXISTS banned (
  user TEXT PRIMARY KEY,
  cookie TEXT
)`);

const mutedUsers = new Map();
const onlineUsers = new Map(); // socket.id -> username
const lastWhisper = new Map(); // last whisper sender per user

// --- Auth ---
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  try {
    await db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash]);
    res.json({ success: true });
  } catch {
    res.json({ success: false, msg: "Username taken" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  const user = await db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, hash]);
  if (!user) return res.json({ success: false, msg: "Invalid credentials" });

  const banned = await db.get("SELECT * FROM banned WHERE user = ?", [username]);
  if (banned) {
    res.cookie("banned", banned.cookie, { maxAge: 10 * 365 * 24 * 60 * 60 * 1000 });
    return res.json({ success: false, msg: "You are banned" });
  }

  res.json({ success: true });
});

// --- Socket.IO ---
io.on("connection", (socket) => {
  let username;

  // Identify user on login
  socket.on("registerSocket", (data) => {
    username = data.username;
    socket.user = username;
    onlineUsers.set(socket.id, username);

    // Send online users list
    io.emit("online-users", Array.from(onlineUsers.values()));
  });

  // Send last 50 messages
  (async () => {
    const messages = await db.all("SELECT * FROM messages ORDER BY id DESC LIMIT 50");
    socket.emit("chat-history", messages.reverse());
  })();

  socket.on("chat", async (data) => {
    const { user, message } = data;

    // Check banned
    const banned = await db.get("SELECT * FROM banned WHERE user = ?", [user]);
    if (banned) return socket.disconnect(true);

    // Check muted
    if (mutedUsers.has(user)) {
      if (Date.now() < mutedUsers.get(user)) return;
      mutedUsers.delete(user);
    }

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
          await db.run("INSERT OR REPLACE INTO banned (user, cookie) VALUES (?, ?)", [target, cookieValue]);
          io.sockets.sockets.forEach(s => { if (s.user === target) s.disconnect(true); });
          socket.emit("ban-cookie", { user: target, cookie: cookieValue });
          break;
      }
      return;
    }

    // Whisper command
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

    // Reply command
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

    // Normal message
    await db.run("INSERT INTO messages (user, message) VALUES (?, ?)", [user, message]);
    socket.user = user;
    io.emit("chat", { user, message });
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
