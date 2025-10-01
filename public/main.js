const socket = io();

const getCookie = (name) => {
  const c = document.cookie.split("; ").find(c => c.trim().startsWith(name + "="));
  return c ? c.split("=")[1] : null;
};

const username = getCookie("username");
const isAdmin = getCookie("admin") === "ADMINSECRET";

// --- Chat Page ---
if (document.getElementById("chatBox")) {
  if (!username) location.href = "/";

  socket.emit("registerSocket", { username });

  const chatBox = document.getElementById("chatBox");
  const usersList = document.getElementById("users");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");

  const addMessage = ({ user, message, timestamp }) => {
    const li = document.createElement("li");
    li.textContent = timestamp ? `[${new Date(timestamp).toLocaleTimeString()}] ${user}: ${message}` : `${user}: ${message}`;
    chatBox.appendChild(li);
    chatBox.scrollTop = chatBox.scrollHeight;
  };

  socket.on("chat-history", msgs => msgs.forEach(addMessage));
  socket.on("chat", addMessage);
  socket.on("whisper", ({ from, to, message }) => {
    addMessage({ user: from, message: `[whisper to ${to}]: ${message}` });
  });
  socket.on("online-users", list => {
    usersList.innerHTML = "";
    list.forEach(u => {
      const li = document.createElement("li");
      li.textContent = u;
      usersList.appendChild(li);
    });
  });

  sendBtn.addEventListener("click", () => {
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit("chat", { user: username, message: msg });
    input.value = "";
  });
}

// --- Admin Page ---
if (document.getElementById("log")) {
  if (!isAdmin) document.body.innerHTML = "Forbidden";

  const log = document.getElementById("log");

  const addLog = (data) => {
    const li = document.createElement("li");
    li.textContent = data.timestamp ? `[${new Date(data.timestamp).toLocaleTimeString()}] ${data.user}: ${data.message}` : `${data.user}: ${data.message}`;
    log.appendChild(li);
  };

  socket.on("admin-log", addLog);
}
