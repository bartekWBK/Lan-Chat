import asyncio
import json
import websockets
import socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import threading
from datetime import datetime, timezone
import cgi
import os
import uuid
import random

chat_history = []
clients = set()
users = dict()
muted = set()
blacklist = set()
os.makedirs("uploads", exist_ok=True)


COLOR_PALETTE = [
    "#007bff", "#28a745", "#e83e8c", "#fd7e14", "#20c997",
    "#6f42c1", "#dc3545", "#17a2b8", "#ffc107", "#6610f2",
    "#b8860b", "#ff1493", "#00ced1", "#ff6347", "#4682b4",
    "#8a2be2", "#ff4500", "#228b22", "#00bfff", "#ff69b4"
]

async def notify_users():
    user_list = [{"nick": u["nick"], "color": u["color"]} for u in users.values()]
    message = json.dumps({"type": "users", "users": user_list, "muted": list(muted), "blacklist": list(blacklist)})

    to_remove = set()
    tasks = []
    for client in clients:
        try:
            tasks.append(asyncio.wait_for(client.send(message), timeout=2))
        except Exception:
            to_remove.add(client)
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            to_remove.add(list(clients)[i])
    for client in to_remove:
        clients.discard(client)
        users.pop(client, None)
    
def get_unique_nick(base_nick):
    existing = set(u["nick"] for u in users.values())
    if base_nick not in existing:
        return base_nick
    i = 1
    while f"{base_nick}_{i}" in existing:
        i += 1
    return f"{base_nick}_{i}"



async def chat_handler(websocket):
    peer_ip = websocket.remote_address[0]
    if peer_ip in blacklist:
        await websocket.send(json.dumps({"type": "kicked", "reason": "banned"}))
        await websocket.close()
        return
    clients.add(websocket)
    try:
        async for message in websocket:
            data = json.loads(message)
            nick = data.get("nick", "Unknown")
            msg_type = data.get("type")
            if msg_type == "get-history":
                # Send chat history to the requester only
                await websocket.send(json.dumps({
                    "type": "history",
                    "messages": chat_history
                }))
                continue
            if msg_type == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
                continue
            if msg_type == "join":
                peer_ip = websocket.remote_address[0]
                if peer_ip == "localhost":
                    await websocket.send(json.dumps({"type": "IP", "ip": SERVER_IP, "muted": list(muted)}))
                    continue
                color = random.choice(COLOR_PALETTE)
                new_nick = get_unique_nick(nick)
                users[websocket] = {"nick": new_nick, "color": color}

                is_admin = peer_ip == SERVER_IP or (SERVER_IP == "127.0.0.1" and peer_ip in ("127.0.0.1", "localhost"))
                users[websocket] = {"nick": new_nick, "color": color, "is_admin": is_admin}
                
                for ws in list(users.keys()):
                    if ws != websocket and users[ws]["nick"] == new_nick:
                        try:
                            await ws.send(json.dumps({"type": "kicked", "reason": "duplicate"}))
                        except:
                            pass
                        await ws.close()
                        users.pop(ws, None)
                        clients.discard(ws)
                            
                await notify_users()
                await websocket.send(json.dumps({"type": "nick-update", "nick": new_nick}))
                await websocket.send(json.dumps({"type": "IP", "ip": SERVER_IP, "is_admin": is_admin, "muted": list(muted)}))
                await websocket.send(json.dumps({
                    "type": "history-available",
                    "available": bool(chat_history)
                }))
                continue
            if msg_type == "admin":
                peer_ip = websocket.remote_address[0]
                if peer_ip == SERVER_IP or (SERVER_IP == "127.0.0.1" and peer_ip in ("127.0.0.1", "localhost")):
                    action = data.get("action")
                    if action == "ban":
                        user_to_ban = data.get("user")
                        for ws, info in list(users.items()):
                            if info["nick"] == user_to_ban:
                                ban_ip = ws.remote_address[0]
                                blacklist.add(ban_ip)
                                await ws.send(json.dumps({"type": "kicked", "reason": "banned"}))
                                await ws.close()
                                users.pop(ws, None)
                                clients.discard(ws)
                                break
                        await notify_users()
                    elif action == "unban":
                        ip_to_unban = data.get("ip")
                        blacklist.discard(ip_to_unban)
                    elif action == "wipe-blacklist":
                        blacklist.clear()
                    if action == "clear-files":
                        deleted_files = []
                        for fname in os.listdir("uploads"):
                            try:
                                os.remove(os.path.join("uploads", fname))
                                deleted_files.append(fname)
                            except Exception:
                                pass
                        await notify_users()
                        msg = json.dumps({"type": "files-cleared"})
                        await asyncio.gather(*[asyncio.create_task(client.send(msg)) for client in clients])
                        if deleted_files:
                            del_msg = json.dumps({"type": "file-deleted", "files": deleted_files})
                            await asyncio.gather(*[asyncio.create_task(client.send(del_msg)) for client in clients])
                    elif action == "mute":
                        user_to_mute = data.get("user")
                        for ws, info in users.items():
                            if info["nick"] == user_to_mute:
                                muted.add(user_to_mute)
                                await notify_users()
                                await ws.send(json.dumps({"type": "muted"}))
                    elif action == "unmute":
                        user_to_unmute = data.get("user")
                        muted.discard(user_to_unmute)
                        for ws, info in users.items():
                            if info["nick"] == user_to_unmute:
                                await notify_users()
                                await ws.send(json.dumps({"type": "unmuted"}))
                        
                    elif action == "kick":
                        user_to_kick = data.get("user")
                        for ws, info in list(users.items()):
                            if info["nick"] == user_to_kick:
                                await ws.send(json.dumps({"type": "kicked", "reason": "kicked"}))
                                await ws.close()
                                break

            if websocket not in users:
                continue

            if msg_type == "color":
                color = data.get("color", "#28a745")
                users[websocket]["color"] = color
                await notify_users()
                continue

            if msg_type == "message":
                if users[websocket]["nick"] in muted:
                    continue
                text = data.get("text", "")
                timestamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
                msg_obj = {
                    "type": "message",
                    "nick": users[websocket]["nick"],
                    "color": users[websocket]["color"],
                    "text": text,
                    "timestamp": timestamp
                }
                final = json.dumps(msg_obj)
                chat_history.append(msg_obj)
                # Limit history to last 200 messages
                if len(chat_history) > 200:
                    chat_history.pop(0)
                await asyncio.gather(*[asyncio.create_task(client.send(final)) for client in clients])
    except:
        pass
    finally:
        clients.discard(websocket)
        users.pop(websocket, None)
        await notify_users()
def get_connections_by_nick(nick):
    return [ws for ws, info in users.items() if info["nick"] == nick]
    
def get_server_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip

SERVER_IP = get_server_ip()


class CustomHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/file-list":
            files = []
            for fname in os.listdir("uploads"):
                if os.path.isfile(os.path.join("uploads", fname)):
                    files.append(fname)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(files).encode("utf-8"))
            return
        if self.path.startswith("/uploads/"):
            file_path = self.path.lstrip("/")
            file_path = os.path.normpath(file_path)
            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                filename = os.path.basename(file_path)
                try:
                    filename.encode("ascii")
                    content_disp = f'attachment; filename="{filename}"'
                except UnicodeEncodeError:
                    from urllib.parse import quote
                    content_disp = f"attachment; filename*=UTF-8''{quote(filename)}"
                self.send_header("Content-Disposition", content_disp)
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, "File not found")
                return

        if self.path == "/" or self.path == "/index.html":
            with open("index.html", "r", encoding="utf-8") as f:
                content = f.read()
            content = content.replace(
                "<title>LAN CHAT</title>",
                f"<title>LAN CHAT - {SERVER_IP}</title>"
            )
            self.send_response(200)
            self.send_header("Content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(content.encode("utf-8"))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/upload":
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={'REQUEST_METHOD': 'POST'}
            )
            fileitem = form['file']
            if fileitem.filename:
                # Use the original filename, but sanitize it!
                filename = os.path.basename(fileitem.filename)
                filepath = os.path.join("uploads", filename)
                # If file exists, add a suffix to avoid overwrite
                base, ext = os.path.splitext(filename)
                i = 1
                while os.path.exists(filepath):
                    filename = f"{base}_{i}{ext}"
                    filepath = os.path.join("uploads", filename)
                    i += 1
                with open(filepath, 'wb') as f:
                    f.write(fileitem.file.read())
                self.send_response(200)
                self.end_headers()
                self.wfile.write(filename.encode())
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"No file uploaded")
        else:
            self.send_response(404)
            self.end_headers()


def start_http_server():
    httpd = ThreadingHTTPServer(("0.0.0.0", 8000), CustomHandler)
    print("Website running at http://localhost:8000")
    httpd.serve_forever()

threading.Thread(target=start_http_server, daemon=True).start()

async def start_websocket():
    async with websockets.serve(chat_handler, "0.0.0.0", 6789):
        print("WebSocket server running at ws://localhost:6789")
        await asyncio.Future()

asyncio.run(start_websocket())
