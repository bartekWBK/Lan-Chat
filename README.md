# <b>LAN Chat</b> 💬 <i> by bartekWBK1 </i>

![Preview](https://drive.google.com/thumbnail?id=1BQkOeGLxrafFZNFQcnjGN0Dr7F5xrvhU&sz=s4000)

LAN Chat is a simple local network chat app that runs in your browser. 
It uses a Python WebSocket server for real-time communication and a lightweight front-end built with HTML, CSS, and JavaScript.

---

## 📁 Project Structure

```text
LAN Chat/
│
├── Public/
│   ├── chat.js # Front-end logic
│   ├── index.html # Main UI
│   ├── style.css # Styles (light & dark themes)
│   ├── prism.js # Syntax highlighting (Prism)
│   ├── prism.css
│   ├── icon.png
|   └── server.py # WebSocket + HTTP server
│
|
├── Logs/
│   └── JoinLogs/ # Connection logs (joins and leaves)
│
└── UserData/
    ├── users.json # Registered users
    └── sessions.json # Active sessions
```

---

## ⚙️ Features

- Real-time LAN chat via WebSockets 
- Login / registration with persistent sessions 
- Optional <b>end-to-end</b> message encryption
- File uploads, image previews, and direct pasting (Ctrl + V) 
- GIF support and reply buttons
- Syntax-highlighted code blocks (Prism.js) 
- Extensive client settings (dark/light mode, auto-recover chat, timestamps, custom nick colors, and more)
- Admin tools (mute, ban, wipe blacklist, etc.) 
- Lightweight connection logging (joins and leaves)

![Settings Preview](https://drive.google.com/thumbnail?id=19qQtb3uLDqioh_3DNInpd9KCvncPAWti&sz=s4000)

---

## 🚀 Getting Started

### Requirements
- Python 3.10 or newer 
- `websockets` package 
`pip install websockets`

### Run the Server

You can run `server.py` from anywhere on your machine:
```bash
python server.py
```

Default ports:
- WebSocket → `ws://<your-ip>:6789`
- HTTP → `http://<your-ip>:8000`

### Open the Chat
On any device in the same LAN:
`http://<your-local-ip>:8000`

---

## 👥 Users & Sessions

- User accounts → `UserData/users.json` 
- Active sessions → `UserData/sessions.json` 
- Sessions persist after server restart 
- Each user can only have one active session at a time 

---

## 🛠️ Admin Controls

If you’re the host (server IP matches your device IP): 
You automatically become **admin** and can:
- Mute / unmute users 
- Ban / unban IPs 
- Wipe the blacklist 
- Clear logs 

---

## 🧩 Notes

- Uploaded files → `/Public/uploads/` 
- Logs → `/Logs/` 
- Settings → stored in `localStorage` or synced in `/UserData/users` (JSON)

---

## ⚡ Troubleshooting

| Issue | Fix |
|-------|-----|
| Server won't start | Ensure ports 6789 & 8000 are open |
| Others can’t join | All devices must be on the same LAN |
| Session expired | Delete `UserData/sessions.json` and restart |

---

## 📜 License

This project is open for personal or educational use. 
Feel free to modify and improve it.

---

**Made with love by bartekWBK1**