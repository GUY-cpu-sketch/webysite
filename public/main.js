const socket = io();
let currentUser;

// --- Forms ---
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatBox = document.getElementById("chatBox");
const onlineBox = document.getElementById("onlineUsers");

// --- Login/Register ---
if (loginForm) {
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const username = loginForm.username.value;
    const password = loginForm.password.value;
    const res = await fetch("/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    }).then(r => r.json());
    if (res.success) {
      currentUser = username;
      window.location.href = "chat.html";
    } else alert(res.msg);
  });
}

if (registerForm) {
  registerForm.addEventListener("submit", async e => {
    e.preventDefault();
    const username = registerForm.username.value;
    const password = registerForm.password.value;
    const res = await fetch("/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    }).then(r => r.json());
    if (res.success) alert("Registered! Now login.");
    else alert(res.msg);
  });
}

// --- Chat ---
if (chatForm) {
  socket.emit("registerSocket", { username: currentUser });

  socket.on("chat-history", msgs => {
    chatBox.innerHTML = "";
    msgs.forEach(m => addMessage(m));
  });

  socket.on("chat", msg => addMessage(msg));

  socket.on("online-users", users => {
    onlineBox.innerHTML = users.map(u => `<li>${u}</li>`).join("");
  });

  chatForm.addEventListener("submit", e => {
    e.preventDefault();
    const message = chatInput.value;
    socket.emit("chat", message);
    chatInput.value = "";
  });
}

function addMessage(msg) {
  const p = document.createElement("p");
  if (msg.type === "system") p.innerHTML = `<em>${msg.message}</em>`;
  else if (msg.type === "whisper") p.innerHTML = `<strong>[Whisper ${msg.from}→${msg.to}]</strong> ${msg.message}`;
  else if (msg.type === "reply") p.innerHTML = `<strong>[Reply ${msg.from}→${msg.to}]</strong> ${msg.message}`;
  else p.innerHTML = `<strong>${msg.user}:</strong> ${msg.message}`;
  chatBox.appendChild(p);
  chatBox.scrollTop = chatBox.scrollHeight;
}
