import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// --- In-memory storage ---
let users = {}; // { username: socketId }
let admins = new Set(["DEV"]); // default admin
let mutedUsers = {}; // { username: untilTimestamp }
let bannedUsers = new Set();
let lastWhispers = {}; // track last whisper target

// --- Simple register/login (in-memory, NOT secure for prod) ---
let accounts = {}; // { username: password }

app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (accounts[username]) return res.status(400).json({ error: "User exists" });
  accounts[username] = password;
  res.json({ success: true });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (accounts[username] !== password) {
    return res.status(400).json({ error: "Invalid login" });
  }
  res.json({ success: true });
});

// --- Socket.IO ---
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("setUsername", (username) => {
    if (bannedUsers.has(username)) {
      socket.emit("banned");
      socket.disconnect();
      return;
    }
    socket.username = username;
    users[username] = socket.id;
    io.emit("system", `${username} joined the chat.`);
  });

  socket.on("chat message", (msg) => {
    if (!socket.username) return;

    // Check mute
    if (mutedUsers[socket.username] && mutedUsers[socket.username] > Date.now()) {
      socket.emit("system", "You are muted.");
      return;
    }

    // Handle commands
    if (msg.startsWith("/")) {
      const parts = msg.split(" ");
      const command = parts[0];
      const targetUser = parts[1];
      const arg = parts.slice(2).join(" ");

      switch (command) {
        case "/close":
          if (socket.username === "DEV") {
            if (users[targetUser]) {
              io.to(users[targetUser]).emit("forceClose");
            }
          }
          break;

        case "/mute":
          if (socket.username === "DEV") {
            const duration = parseInt(arg) || 60;
            mutedUsers[targetUser] = Date.now() + duration * 1000;
            if (users[targetUser]) {
              io.to(users[targetUser]).emit("muted", duration);
            }
          }
          break;

        case "/ban":
          if (socket.username === "DEV") {
            bannedUsers.add(targetUser);
            if (users[targetUser]) {
              io.to(users[targetUser]).emit("banned");
              io.sockets.sockets.get(users[targetUser])?.disconnect();
            }
          }
          break;

        case "/whisper":
          const toUser = parts[1];
          const privateMsg = parts.slice(2).join(" ");
          if (users[toUser]) {
            io.to(users[toUser]).emit("whisper", {
              from: socket.username,
              message: privateMsg
            });
            lastWhispers[toUser] = socket.username;

            // admins see whispers
            for (let u in users) {
              if (admins.has(u)) {
                io.to(users[u]).emit("adminWhisper", {
                  from: socket.username,
                  to: toUser,
                  message: privateMsg
                });
              }
            }
          }
          break;

        case "/reply":
          if (lastWhispers[socket.username]) {
            const replyMsg = parts.slice(1).join(" ");
            const lastFrom = lastWhispers[socket.username];
            if (users[lastFrom]) {
              io.to(users[lastFrom]).emit("whisper", {
                from: socket.username,
                message: replyMsg
              });
            }
          }
          break;

        default:
          socket.emit("system", "Unknown command.");
      }
      return;
    }

    // Normal chat
    io.emit("chat message", { user: socket.username, text: msg });
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      delete users[socket.username];
      io.emit("system", `${socket.username} left the chat.`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
