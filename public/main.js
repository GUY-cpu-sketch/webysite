let currentUser = null;
let lastWhisperFrom = null;
let socket;

// ==== LOGIN & REGISTER LOGIC ====
const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");

if (registerForm) {
  registerForm.addEventListener("submit", async e => {
    e.preventDefault();
    const username = registerForm.username.value;
    const password = registerForm.password.value;

    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    }).then(r => r.json());

    if (res.success) {
      alert("Registered! Now login.");
      window.location.href = "login.html";
    } else alert(res.msg);
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const username = loginForm.username.value;
    const password = loginForm.password.value;

    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    }).then(r => r.json());

    if (res.success) {
      currentUser = username;
      window.location.href = "chat.html";
    } else alert(res.msg);
  });
}

// ==== CHAT PAGE LOGIC ====
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatBox = document.getElementById("chatBox");

if (chatForm && chatInput && chatBox) {
  socket = io();

  chatForm.addEventListener("submit", e => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;

    socket.emit("chat", { message: msg });
    chatInput.value = "";
  });

  socket.on("chat", data => {
    const p = document.createElement("p");
    p.textContent = `${data.user}: ${data.message}`;
    p.style.color = "white";
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  socket.on("whisper", data => {
    lastWhisperFrom = data.from;
    const p = document.createElement("p");
    p.textContent = `(Whisper) ${data.from} ➝ ${data.to}: ${data.message}`;
    p.style.background = "yellow";
    p.style.color = "black";
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  socket.on("system", msg => {
    const p = document.createElement("p");
    p.textContent = `[SYSTEM] ${msg}`;
    p.style.color = "lightgray";
    chatBox.appendChild(p);
  });
}

// ==== ADMIN PAGE LOGIC ====
const adminBox = document.getElementById("adminBox");
const adminCmdForm = document.getElementById("adminCmdForm");
const adminCmdInput = document.getElementById("adminCmdInput");

if (adminBox) {
  socket = io();

  // Show all messages (including whispers)
  socket.on("chat", data => {
    const p = document.createElement("p");
    p.textContent = `${data.user}: ${data.message}`;
    adminBox.appendChild(p);
    adminBox.scrollTop = adminBox.scrollHeight;
  });

  socket.on("whisper", data => {
    const p = document.createElement("p");
    p.textContent = `(Whisper) ${data.from} ➝ ${data.to}: ${data.message}`;
    p.style.background = "yellow";
    p.style.color = "black";
    adminBox.appendChild(p);
    adminBox.scrollTop = adminBox.scrollHeight;
  });

  socket.on("system", msg => {
    const p = document.createElement("p");
    p.textContent = `[SYSTEM] ${msg}`;
    p.style.color = "red";
    adminBox.appendChild(p);
  });

  // Admin command form
  if (adminCmdForm && adminCmdInput) {
    adminCmdForm.addEventListener("submit", e => {
      e.preventDefault();
      const cmd = adminCmdInput.value.trim();
      if (!cmd) return;

      socket.emit("adminCmd", { command: cmd });
      adminCmdInput.value = "";
    });
  }
}
