import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import { createServer } from "http";
import { Server } from "socket.io";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
const server = createServer(app);
const io = new Server(server);

// Database setup
const dbPromise = open({
  filename: "./database.db",
  driver: sqlite3.Database
});

// Middleware
app.use(express.static("public")); // serve /public files
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: "supersecretkey",
  resave: false,
  saveUninitialized: true
}));

// Root route
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

// Login
app.post("/login", async (req, res) => {
  const db = await dbPromise;
  const { username, password } = req.body;
  const user = await db.get(
    "SELECT * FROM users WHERE username = ? AND password = ?",
    [username, password]
  );

  if (user) {
    req.session.user = user;
    res.redirect("/chat.html");
  } else {
    res.redirect("/login.html?error=1");
  }
});

// Register
app.post("/register", async (req, res) => {
  const db = await dbPromise;
  const { username, password } = req.body;
  const existing = await db.get(
    "SELECT * FROM users WHERE username = ?",
    [username]
  );

  if (existing) {
    res.redirect("/register.html?error=1");
  } else {
    await db.run("INSERT INTO users (username, password) VALUES (?, ?)", [
      username,
      password
    ]);
    res.redirect("/login.html?success=1");
  }
});

// Chat sockets
io.on("connection", (socket) => {
  console.log("✅ User connected");

  socket.on("chat", (msg) => {
    io.emit("chat", { user: "Anonymous", message: msg });
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected");
  });
});

// Start server
server.listen(10000, () => {
  console.log("✅ Server running on port 10000");
});
