// Login
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    const msgEl = document.getElementById("loginMsg");

    if (data.success) {
      window.location.href = "chat.html";
    } else {
      msgEl.textContent = data.msg;
    }
  });
}

// Register
const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const res = await fetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    const msgEl = document.getElementById("registerMsg");

    if (data.success) {
      msgEl.textContent = "Registered! Redirecting to login...";
      setTimeout(() => window.location.href = "login.html", 1000);
    } else {
      msgEl.textContent = data.msg;
    }
  });
}
