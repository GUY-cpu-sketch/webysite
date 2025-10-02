let currentUser = null;

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
