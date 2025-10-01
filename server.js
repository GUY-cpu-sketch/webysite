import express from "express";
import http from "http";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(cookieParser());
app.use(express.static("public"));

const mutedUsers = new Map();
const onlineUsers = new Map();
const lastWhisper = new Map();

// Use in-memory storage for messages
const messages = [];

// Admin cookie
const ADMIN_COOKIE = "DEV_SECRET";

// --- Auth ---
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  // In-memory users
  if (!app.locals.users) app.locals.users = {};
  if (app.locals.users[username]) return res.json({ success: false, msg: "Username taken" });
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  app.locals.users[username] = { password: hash };
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!app.locals.users || !app.locals.users[username]) return res.json({ success: false, msg: "Invalid credentials" });
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (app.locals.users[username].password !== hash) return res.json({ success: false, msg: "Invalid credentials" });

  if (username === "DEV") res.cookie("admin", ADMIN_COOKIE, { httpOnly: true });
  res.json({ success: true });
});

// --- Admin page ---
app.get("/admin", (req, res) => {
  if (req.cookies.admin !== ADMIN_COOKIE) return res.status(403).send("Forbidden");
  res.sendFile(`${process.cwd()}/public/admin.html`);
});

// --- Socket.IO ---
io.on("connection", (socket) => {
  let username;

  socket.on("registerSocket", (data) => {
    username = data.username;
    socket.user = username;
    onlineUsers.set(socket.id, username);

    // Send online users
    io.emit("online-users", Array.from(onlineUsers.values()));
    // Send last 50 messages
    socket.emit("chat-history", messages.slice(-50));
  });

  socket.on("chat", (data) => {
    const { user, message } = data;

    if (mutedUsers.has(user) && Date.now() < mutedUsers.get(user)) return;
    if (mutedUsers.has(user)) mutedUsers.delete(user);

    // Admin commands in chat
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
          io.sockets.sockets.forEach(s => { if (s.user === target) s.disconnect(true); });
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
        if (s.user === targetUser || s.user === user || s.user === "DEV") {
          s.emit("whisper", { from: user, to: targetUser, message: msg });
        }
      });

      // Stream to admin page
      io.emit("admin-message", { type: "whisper", from: user, to: targetUser, message: msg });
      messages.push({ user, message, type: "whisper" });
      return;
    }

    // Reply
    if (message.startsWith("/reply ")) {
      const msg = message.slice(7);
      const targetUser = lastWhisper.get(user);
      if (!targetUser) return;
      lastWhisper.set(targetUser, user);

      io.sockets.sockets.forEach(s => {
        if (s.user === targetUser || s.user === user || s.user === "DEV") {
          s.emit("whisper", { from: user, to: targetUser, message: msg });
        }
      });

      io.emit("admin-message", { type: "reply", from: user, to: targetUser, message: msg });
      messages.push({ user, message: msg, type: "reply" });
      return;
    }

    // Normal message
    messages.push({ user, message, type: "chat" });
    io.emit("chat", { user, message });
    io.emit("admin-message", { type: "chat", user, message });
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
