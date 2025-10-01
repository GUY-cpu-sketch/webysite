import express from "express";
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
lastWhisper.set(targetUser, user);
io.sockets.sockets.forEach(s => {
if (s.user === targetUser || s.user === user || user === "DEV") s.emit("whisper", { from: user, to: targetUser, message: msg });
});
adminSockets.forEach(s => s.emit("whisper", { from: user, to: targetUser, message: msg }));
return;
}


// Reply
if (message.startsWith("/reply ")) {
const msg = message.slice(7);
const targetUser = lastWhisper.get(user);
if (!targetUser) return;
lastWhisper.set(targetUser, user);
io.sockets.sockets.forEach(s => {
if (s.user === targetUser || s.user === user || user === "DEV") s.emit("whisper", { from: user, to: targetUser, message: msg });
});
adminSockets.forEach(s => s.emit("whisper", { from: user, to: targetUser, message: msg }));
return;
}


messages.push({ user, message });
io.emit("chat", { user, message });
adminSockets.forEach(s => s.emit("chat", { user, message }));
});


socket.on("disconnect", () => {
onlineUsers.delete(socket.id);
io.emit("online-users", Array.from(onlineUsers.values()));
if (isAdmin) adminSockets.delete(socket);
});
});


server.listen(process.env.PORT || 3000, () => console.log("Server running"));
