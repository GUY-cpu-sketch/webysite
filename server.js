import express from "express";
import http from "http";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cookieParser());
app.use(express.json());
app.use(express.static("public"));

// --- In-memory storage ---
const users = new Map(); // username -> password hash
const onlineUsers = new Map(); // socket.id -> username
const mutedUsers = new Map();
const lastWhisper = new Map();

// --- Admin cookie ---
const ADMIN_SECRET = "ADMINSECRET";

// --- Routes ---
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (users.has(username)) return res.json({ success: false, msg: "Username taken" });
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  users.set(username, hash);
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (!users.has(username) || users.get(username) !== hash)
    return res.json({ success: false, msg: "Invalid credentials" });

  // Admin login
  if (username === "DEV") res.cookie("admin", ADMIN_SECRET, { maxAge: 24*60*60*1000 });

  res.cookie("username", username, { maxAge: 24*60*60*1000 });
  res.json({ success: true });
});

// --- Socket.IO ---
io.on("connection", (socket) => {
  let username;

  socket.on("registerSocket", (data) => {
    username = data.username;
    socket.user = username;
    onlineUsers.set(socket.id, username);

    io.emit("online-users", Array.from(onlineUsers.values()));
  });

  // Send chat history (we only keep last 50 messages in memory)
  socket.chatHistory = socket.chatHistory || [];
  socket.chatHistory.forEach(msg => socket.emit("chat-history", msg));

  socket.on("chat", (data) => {
    const { user, message } = data;

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
      }

      // Send command to admin page
      io.emit("admin-log", { user, message, timestamp: Date.now() });
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
          io.emit("admin-log", { user: "WHISPER", message: `${user} → ${targetUser}: ${msg}`, timestamp: Date.now() });
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
          io.emit("admin-log", { user: "REPLY", message: `${user} → ${targetUser}: ${msg}`, timestamp: Date.now() });
        }
      });
      return;
    }

    // Broadcast chat
    io.emit("chat", { user, message, timestamp: Date.now() });
    io.emit("admin-log", { user, message, timestamp: Date.now() });
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
