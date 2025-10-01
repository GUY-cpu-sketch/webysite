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
const users = new Map(); // username -> { passwordHash }
const banned = new Map(); // username -> cookie
const mutedUsers = new Map(); // username -> timestamp
const onlineUsers = new Map(); // socket.id -> username
const lastWhisper = new Map(); // last whisper sender per user
const messages = []; // { user, message, timestamp }
const adminCookie = "ADMINSECRET"; // change this to your secret

// --- Routes ---
app.get("/", (req, res) => {
  res.sendFile("landing.html", { root: "public" });
});

app.get("/chat", (req, res) => {
  const username = req.cookies.username;
  if (!username || !users.has(username) || banned.has(username)) {
    return res.redirect("/");
  }
  res.sendFile("chat.html", { root: "public" });
});

app.get("/admin", (req, res) => {
  const cookie = req.cookies.admin;
  if (cookie !== adminCookie) return res.status(403).send("Forbidden");
  res.sendFile("admin.html", { root: "public" });
});

// --- Auth ---
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (users.has(username)) return res.json({ success: false, msg: "Username taken" });

  const hash = crypto.createHash("sha256").update(password).digest("hex");
  users.set(username, { passwordHash: hash });
  res.cookie("username", username, { maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = users.get(username);
  if (!user) return res.json({ success: false, msg: "Invalid credentials" });

  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (hash !== user.passwordHash) return res.json({ success: false, msg: "Invalid credentials" });

  if (banned.has(username)) {
    res.cookie("banned", banned.get(username), { maxAge: 10 * 365 * 24 * 60 * 60 * 1000 });
    return res.json({ success: false, msg: "You are banned" });
  }

  res.cookie("username", username, { maxAge: 7 * 24 * 60 * 60 * 1000 });
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

    // send last 50 messages
    socket.emit("chat-history", messages.slice(-50));
  });

  socket.on("chat", (data) => {
    const { user, message } = data;

    if (!user || banned.has(user)) return socket.disconnect(true);

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
          banned.set(target, cookieValue);
          io.sockets.sockets.forEach(s => { if (s.user === target) s.disconnect(true); });
          socket.emit("ban-cookie", { user: target, cookie: cookieValue });
          break;
      }
      // also send command info to admin page
      io.emit("admin-log", { user, message });
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

      // stream to admin
      io.emit("admin-log", { user, message: `[whisper] ${msg}` });
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

      // stream to admin
      io.emit("admin-log", { user, message: `[reply] ${msg}` });
      return;
    }

    // regular message
    const chatMsg = { user, message, timestamp: new Date().toISOString() };
    messages.push(chatMsg);
    io.emit("chat", chatMsg);

    // stream to admin
    io.emit("admin-log", chatMsg);
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
