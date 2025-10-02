// main.js – shared logic for all pages

// ===== Helper: get current page =====
const page = window.location.pathname.split("/").pop();

// ===== Helper: API fetch wrapper =====
async function api(path, data) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  return res.json();
}

// ===== INDEX PAGE =====
if (page === "index.html" || page === "") {
  const agreeBox = document.getElementById("agreeBox");
  const linksDiv = document.getElementById("links");
  const adminLink = document.getElementById("adminLink");

  // Show links only when rules are agreed
  if (agreeBox) {
    agreeBox.addEventListener("change", () => {
      if (agreeBox.checked) {
        linksDiv.classList.remove("hidden");
      } else {
        linksDiv.classList.add("hidden");
      }
    });
  }

  // Check if user is admin to reveal admin link
  fetch("/me")
    .then(res => res.json())
    .then(user => {
      if (user && user.username && user.role === "admin") {
        adminLink.classList.remove("hidden");
      }
    })
    .catch(() => {});
}

// ===== LOGIN PAGE =====
if (page === "login.html") {
  const loginForm = document.getElementById("loginForm");
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const form = new FormData(loginForm);
    const data = {
      username: form.get("username"),
      password: form.get("password")
    };
    const res = await api("/login", data);
    if (res.success) {
      alert("Login successful!");
      window.location.href = "chat.html";
    } else {
      alert("Login failed: " + res.error);
    }
  });
}

// ===== REGISTER PAGE =====
if (page === "register.html") {
  const regForm = document.getElementById("registerForm");
  regForm.addEventListener("submit", async e => {
    e.preventDefault();
    const form = new FormData(regForm);
    const data = {
      username: form.get("username"),
      password: form.get("password")
    };
    const res = await api("/register", data);
    if (res.success) {
      alert("Registration successful! You can now log in.");
      window.location.href = "login.html";
    } else {
      alert("Register failed: " + res.error);
    }
  });
}

// ===== CHAT PAGE =====
if (page === "chat.html") {
  const socket = io();
  const chatBox = document.getElementById("chatBox");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");

  socket.on("chat", data => {
    const p = document.createElement("p");
    if (data.type === "whisper") {
      p.classList.add("whisper");
      p.textContent = `(whisper) ${data.from} ➝ ${data.to}: ${data.message}`;
    } else if (data.type === "reply") {
      p.classList.add("whisper");
      p.textContent = `(reply) ${data.from}: ${data.message}`;
    } else if (data.type === "system") {
      p.classList.add("system");
      p.textContent = `[SYSTEM] ${data.message}`;
    } else {
      p.textContent = `${data.user}: ${data.message}`;
    }
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  chatForm.addEventListener("submit", e => {
    e.preventDefault();
    if (chatInput.value.trim() !== "") {
      socket.emit("chat", chatInput.value);
      chatInput.value = "";
    }
  });
}

// ===== ADMIN PAGE =====
if (page === "admin.html") {
  const socket = io();
  const adminBox = document.getElementById("adminBox");

  // Stream all messages here too
  socket.on("chat", data => {
    const p = document.createElement("p");
    if (data.type === "whisper") {
      p.textContent = `(whisper) ${data.from} ➝ ${data.to}: ${data.message}`;
    } else if (data.type === "reply") {
      p.textContent = `(reply) ${data.from}: ${data.message}`;
    } else if (data.type === "system") {
      p.textContent = `[SYSTEM] ${data.message}`;
    } else {
      p.textContent = `${data.user}: ${data.message}`;
    }
    adminBox.appendChild(p);
    adminBox.scrollTop = adminBox.scrollHeight;
  });

  // Command sender for buttons
  window.sendCommand = function(cmd) {
    const target = prompt("Enter username (leave blank if not needed):");
    const fullCmd = target ? cmd.replace("USERNAME", target) : cmd;
    socket.emit("chat", fullCmd);
  };
}
