import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server } from "socket.io";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

// In-memory storage
const users = {
  admin: { password: "admin123", role: "admin" },
  test: { password: "test123", role: "user" }
};

const chatHistory = [];
const mutedUsers = new Map(); // username -> timestamp
const bannedUsers = new Map(); // username -> true
const lastWhisper = new Map(); // username -> last whisper sender
const onlineUsers = new Map(); // socket.id -> username

// --- Auth ---
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (users[username]) return res.json({ success: false, msg: "Username taken" });
  users[username] = { password, role: "user" };
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user || user.password !== password) return res.json({ success: false, msg: "Invalid credentials" });

  if (user.role === "admin") res.cookie("admin", "true", { httpOnly: false });
  res.json({ success: true });
});

// Protect admin page
app.get("/admin.html", (req, res, next) => {
  if (req.cookies.admin === "true") next();
  else res.status(403).send("Forbidden – Admins only");
});

// --- Socket.IO ---
io.on("connection", socket => {
  let username;

  // Send chat history
  socket.emit("chat-history", chatHistory.slice(-50));

  socket.on("registerSocket", data => {
    username = data.username;
    onlineUsers.set(socket.id, username);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });

  socket.on("chat", async message => {
    if (!username) return;

    if (bannedUsers.get(username)) return socket.disconnect(true);
    if (mutedUsers.has(username) && Date.now() < mutedUsers.get(username)) return;
    if (mutedUsers.has(username)) mutedUsers.delete(username);

    // Admin commands
    if (username === "admin" && message.startsWith("/")) {
      const parts = message.split(" ");
      const cmd = parts[0];
      const target = parts[1];

      switch (cmd) {
        case "/close":
          io.sockets.sockets.forEach(s => { if (onlineUsers.get(s.id) === target) s.disconnect(true); });
          break;
        case "/mute":
          let duration = 60000;
          if (parts[2]) duration = parseInt(parts[2]) * 1000;
          mutedUsers.set(target, Date.now() + duration);
          break;
        case "/ban":
          bannedUsers.set(target, true);
          io.sockets.sockets.forEach(s => { if (onlineUsers.get(s.id) === target) s.disconnect(true); });
          break;
      }
      chatHistory.push({ type: "system", message: `Admin ran: ${message}` });
      io.emit("chat", { type: "system", message: `Admin ran: ${message}` });
      return;
    }

    // Whisper
    if (message.startsWith("/whisper ")) {
      const parts = message.split(" ");
      const targetUser = parts[1];
      const msg = parts.slice(2).join(" ");
      lastWhisper.set(targetUser, username);

      io.sockets.sockets.forEach(s => {
        if (onlineUsers.get(s.id) === targetUser || onlineUsers.get(s.id) === username || username === "admin") {
          s.emit("chat", { type: "whisper", from: username, to: targetUser, message: msg });
        }
      });
      return;
    }

    // Reply
    if (message.startsWith("/reply ")) {
      const msg = message.slice(7);
      const targetUser = lastWhisper.get(username);
      if (!targetUser) return;
      lastWhisper.set(targetUser, username);

      io.sockets.sockets.forEach(s => {
        if (onlineUsers.get(s.id) === targetUser || onlineUsers.get(s.id) === username || username === "admin") {
          s.emit("chat", { type: "reply", from: username, to: targetUser, message: msg });
        }
      });
      return;
    }

    // Normal message
    chatHistory.push({ user: username, message });
    io.emit("chat", { user: username, message });
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
