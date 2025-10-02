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

// In-memory storage
const users = new Map();      // username -> password hash
const mutedUsers = new Map(); // username -> mute expiration
const bannedUsers = new Map(); // username -> cookie
const onlineUsers = new Map(); // socket.id -> username
const lastWhisper = new Map(); // username -> last whisper sender

const ADMIN_USER = "DEV";
const ADMIN_PASS = "Roblox2011!"; // example, hash later
const ADMIN_COOKIE = "supersecretadmintoken";

// --- Pages ---
// Serve admin only if correct cookie
app.get("/admin", (req, res) => {
  const cookie = req.cookies.admin;
  if (cookie === ADMIN_COOKIE) {
    res.sendFile(`${__dirname}/public/admin.html`);
  } else {
    res.redirect("/login.html");
  }
});

// --- Auth ---
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

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.cookie("admin", ADMIN_COOKIE, { maxAge: 10*365*24*60*60*1000 }); // 10 years
    return res.json({ success: true, admin: true });
  }

  if (!users.has(username) || users.get(username) !== hash) {
    return res.json({ success: false, msg: "Invalid credentials" });
  }

  if (bannedUsers.has(username)) {
    res.cookie("banned", bannedUsers.get(username), { maxAge: 10*365*24*60*60*1000 });
    return res.json({ success: false, msg: "You are banned" });
  }

  res.json({ success: true });
});

// --- Socket.IO ---
io.on("connection", socket => {
  let username;

  socket.on("registerSocket", data => {
    username = data.username;
    socket.user = username;
    onlineUsers.set(socket.id, username);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });

  socket.on("chat", data => {
    const { message } = data;

    if (!username) return;
    if (mutedUsers.has(username) && Date.now() < mutedUsers.get(username)) return;
    if (mutedUsers.has(username)) mutedUsers.delete(username);

    // Admin commands
    if (username === ADMIN_USER && message.startsWith("/")) {
      const parts = message.split(" ");
      const cmd = parts[0];
      const target = parts[1];

      switch (cmd) {
        case "/close":
          io.sockets.sockets.forEach(s => { if (s.user === target) s.disconnect(true); });
          break;
        case "/mute":
          let duration = 60000;
          if (parts[2]) duration = parseInt(parts[2])*1000;
          mutedUsers.set(target, Date.now() + duration);
          break;
        case "/ban":
          const cookieValue = `${target}-${Date.now()}`;
          bannedUsers.set(target, cookieValue);
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
      lastWhisper.set(targetUser, username);
      io.sockets.sockets.forEach(s => {
        if (s.user === targetUser || s.user === username || username === ADMIN_USER) {
          s.emit("whisper", { from: username, to: targetUser, message: msg });
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
        if (s.user === targetUser || s.user === username || username === ADMIN_USER) {
          s.emit("whisper", { from: username, to: targetUser, message: msg });
        }
      });
      return;
    }

    io.emit("chat", { user: username, message });
  });

  socket.on("adminCmd", data => {
    if (username !== ADMIN_USER) return;
    const cmdMsg = data.command;
    // same logic as above for commands
    socket.emit("system", `Command received: ${cmdMsg}`);
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    io.emit("online-users", Array.from(onlineUsers.values()));
  });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running"));
