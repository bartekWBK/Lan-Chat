# <b>LAN Chat</b> 💬 <i> by bartekWBK1 </i>

![Preview](https://media.discordapp.net/attachments/806132814540963840/1424419575256322139/image.png?ex=68e3e19b&is=68e2901b&hm=305e49b45dcbfdd1ddea31bf1f909851b2d2a6f67f0c00307db09a97476af3c7&=&format=webp&quality=lossless&width=1701&height=859)

LAN Chat is a simple local network chat app that runs in your browser.  
It uses a Python WebSocket server for real-time communication and a lightweight front-end built with HTML, CSS, and JavaScript.

---

## 📁 Project Structure

- LAN Chat/
- │
- ├── Public/
- │ ├── server.py # WebSocket + HTTP server
- │ ├── chat.js # Front-end logic
- │ ├── index.html # Main UI
- │ ├── style.css # Styles (light & dark themes)
- │ ├── prism.js # Syntax highlighting (Prism)
- │ ├── prism.css
- │ └── icon.png
- │
- ├── Logs/
- │ ├── AllLogs/ # Chat logs
- │ └── IpLogs/ # IP logs
- │
- └── UserData/
- ├── users.json # Registered users
- └── sessions.json # Active sessions


---

## ⚙️ Features

- Real-time LAN chat via WebSockets  
- Login / registration with persistent sessions  
- File uploads + image previews  
- Paste images directly (Ctrl + V)  
- Syntax-highlighted code blocks (Prism.js)  
- Dark / light mode  
- Custom nickname colors  
- Admin tools (mute, ban, wipe blacklist, etc.)  
- Chat + IP logging  

---

## 🚀 Getting Started

### Requirements
- Python 3.10 or newer  
- `websockets` package  
<i><b>pip install websockets</b></i>


### Run the Server

<b>From the `Public` folder</b>:
python server.py | <i><b> ❗ Make sure you run it from Pubic folder</i></b>



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
- Settings → stored in `localStorage` OR <br> stored in `/UserData/users` → in json

---

## ⚡ Troubleshooting

| Issue | Fix |
|-------|-----|
| Server won't start | Ensure ports 6789 & 8000 are open |
| Others can’t join | All devices must be on the same LAN |
| Session expired | Delete `UserData/sessions.json` and restart |
| Website opened but nothing's working | Make sure you opened your server file at `/Public` folder


---

## 📜 License

This project is open for personal or educational use.  
Feel free to modify and improve it.

---

**Made with love by bartekWBK1**