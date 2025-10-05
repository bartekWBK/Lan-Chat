import asyncio
import json
import websockets
import socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import threading
from datetime import datetime, timezone
import os
import uuid
import random
from email.parser import BytesParser
from email.policy import default as default_policy
from urllib.parse import unquote
import time
import logging
LoggAllowed = True
SESSION_FILE = "../UserData/sessions.json"
USER_DB_FILE = "../UserData/users.json"
sessions = {}
connected_websockets = {}
verified = []
os.makedirs("../UserData", exist_ok=True)
if LoggAllowed:
    os.makedirs("../Logs", exist_ok=True)
    os.makedirs("../Logs/AllLogs", exist_ok=True)
    os.makedirs("../Logs/IpLogs", exist_ok=True)

if LoggAllowed:
    logging.basicConfig(
        filename="../Logs/AllLogs/" + datetime.now().strftime("%Y-%m-%d   %H_%M    %S") + " (y-m-d h_m s) chat_log.txt",
        level=logging.INFO,
        format="%(asctime)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
if os.path.exists(SESSION_FILE):
    with open(SESSION_FILE, "r", encoding="utf-8") as f:
        sessions = json.load(f)

def save_sessions():
    with open(SESSION_FILE, "w", encoding="utf-8") as f:
        json.dump(sessions, f)

def load_sessions():
    global sessions
    if os.path.exists(SESSION_FILE):
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            sessions = json.load(f)
    else:
        sessions = {}
load_sessions()
def load_users():
    if os.path.exists(USER_DB_FILE):
        with open(USER_DB_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_users(users):
    with open(USER_DB_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f)

def is_user_online(username):
    for token in sessions.get(username, []):
        if token in connected_websockets:
            return True
    return False

users_db = load_users()

chat_history = []
clients = set()
users = dict()
muted = set()
blacklist = set()
os.makedirs("uploads", exist_ok=True)
last_color_change = {}
COLOR_COOLDOWN = 5


COLOR_PALETTE = [
    "#007bff", "#28a745", "#e83e8c", "#fd7e14", "#20c997",
    "#6f42c1", "#dc3545", "#17a2b8", "#ffc107", "#6610f2",
    "#b8860b", "#ff1493", "#00ced1", "#ff6347", "#4682b4",
    "#8a2be2", "#ff4500", "#228b22", "#00bfff", "#ff69b4"
]

def check_For_Barteks_Niggerness(hex_color, bg_light="#f2f2f2", bg_dark="#232323"):
    def hex_to_rgb(h):
        h = h.lstrip("#")
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    rgb = hex_to_rgb(hex_color)
    rgb_light = hex_to_rgb(bg_light)
    rgb_dark = hex_to_rgb(bg_dark)
    dist_light = sum((a - b) ** 2 for a, b in zip(rgb, rgb_light)) ** 0.5
    dist_dark = sum((a - b) ** 2 for a, b in zip(rgb, rgb_dark)) ** 0.5
    if dist_light < 30 or dist_dark < 30:
        return True
    banned = {"#fff", "#ffffff", "#f2f2f2", "#121212", "#232323"}
    return hex_color.lower() in banned

async def notify_users():
    user_list = [{"nick": u["nick"], "color": u["color"], "is_admin": u.get("is_admin", False)} for u in users.values()]
    message = json.dumps({"type": "users", "users": user_list, "muted": list(muted), "blacklist": list(blacklist), "verified": verified})

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

def get_unique_nick(base_nick, force=False):
    existing = set(u["nick"] for u in users.values())
    if force:
        for ws, info in list(users.items()):
            if info["nick"] == base_nick:
                if f"Mr.Fake_{base_nick}" not in existing:
                    new_nick = f"Mr.Fake_{base_nick}"
                    users[ws]["nick"] = new_nick
                    asyncio.create_task(ws.send(json.dumps({"type": "nick-update", "nick": new_nick})))
                    existing.add(new_nick)
                    break
                else:
                    i = 1
                    new_nick = f"Mr.Fake_{base_nick}_{i}"
                    while new_nick in existing:
                        i += 1
                        new_nick = f"Mr.Fake_{base_nick}_{i}"
                    users[ws]["nick"] = new_nick
                    asyncio.create_task(ws.send(json.dumps({"type": "nick-update", "nick": new_nick})))
                    existing.add(new_nick)
                    break
        return base_nick
    if base_nick not in existing:
        return base_nick
    i = 1
    while f"{base_nick}_{i}" in existing:
        i += 1
    return f"{base_nick}_{i}"

async def chat_handler(websocket):
    peer_ip = websocket.remote_address[0]
    if peer_ip in blacklist:
        if LoggAllowed:
            timestamp = datetime.now().strftime("%Y-%m-%d  %H_%M  %S")
            ip_log_path = os.path.join("../Logs", "IpLogs", f"{peer_ip}.txt")
            with open(ip_log_path, "a", encoding="utf-8") as ip_log:
                ip_log.write(f"!!Tried To Join But Banned     | {timestamp} | Nick: {users[websocket]['nick']} \n")
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
                await websocket.send(json.dumps({
                    "type": "history",
                    "messages": chat_history
                }))
                continue
            if msg_type == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
                continue
            if msg_type == "logout-all-sessions":
                username = data.get("username")
                tokens = list(sessions.get(username, {}).keys())
                for token in tokens:
                    ws = connected_websockets.get(token)
                    if ws:
                        await ws.send(json.dumps({"type": "kicked", "reason": "logged-out"}))
                        await ws.close()
                    sessions[username].pop(token, None)
                    connected_websockets.pop(token, None)
                if username in sessions and not sessions[username]:
                    sessions.pop(username)
                save_sessions()
                await websocket.send(json.dumps({"type": "sessions-logged-out"}))
                continue
            if msg_type == "register":
                username = data.get("username")
                password = data.get("password")
                if not username or not password:
                    await websocket.send(json.dumps({"type": "auth-error", "message": "Username and password required"}))
                    continue
                if len(username) < 1 or len(username) > 16:
                    await websocket.send(json.dumps({"type": "auth-error", "message": "Username must be 1-16 characters"}))
                    continue
                if username in users_db:
                    await websocket.send(json.dumps({"type": "auth-error", "message": "Username already exists"}))
                else:
                    users_db[username] = {"password": password}
                    save_users(users_db)
                    token = str(uuid.uuid4())
                    if username not in sessions:
                        sessions[username] = {}
                    sessions[username][token] = {
                        "ip": websocket.remote_address[0],
                        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                    }
                    connected_websockets[token] = websocket
                    verified.append(username)
                    save_sessions()
                    await websocket.send(json.dumps({"type": "register-success"}))
                    await websocket.send(json.dumps({"type": "login-success", "token": token, "username": username}))
                    await websocket.send(json.dumps({
                        "type": "user-settings",
                        "settings": users_db[username].get("settings", {})
                    }))
                    await notify_users()
                continue
            if msg_type == "save-settings":
                username = data.get("username")
                settings = data.get("settings")
                if username in users_db:
                    users_db[username]["settings"] = settings 
                    if "color" in settings:
                        users_db[username]["color"] = settings["color"]  
                    save_users(users_db)
                    await websocket.send(json.dumps({"type": "settings-saved"}))
                else:
                    await websocket.send(json.dumps({"type": "error", "message": "User not found"}))
                continue

            if msg_type == "get-settings":
                username = data.get("username")
                if username in users_db and "settings" in users_db[username]:
                    await websocket.send(json.dumps({
                        "type": "user-settings",
                        "settings": users_db[username]["settings"]
                    }))
                else:
                    await websocket.send(json.dumps({
                        "type": "user-settings",
                        "settings": {}
                    }))
                continue

            if msg_type == "login":
                username = data.get("username")
                password = data.get("password")
                if is_user_online(username):
                    await websocket.send(json.dumps({"type": "auth-error", "message": "This account is already logged in elsewhere."}))
                    continue
                if username in users_db and users_db[username]["password"] == password:
                    token = str(uuid.uuid4())
                    if username not in sessions:
                        sessions[username] = {}
                    sessions[username][token] = {
                        "ip": websocket.remote_address[0],
                        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                    }
                    connected_websockets[token] = websocket
                    verified.append(username)
                    save_sessions()
                    await websocket.send(json.dumps({"type": "login-success", "token": token, "username": username}))
                    await websocket.send(json.dumps({
                        "type": "user-settings",
                        "settings": users_db[username].get("settings", {})
                    }))
                    await notify_users()
                else:
                    await websocket.send(json.dumps({"type": "auth-error", "message": "Invalid credentials"}))
                continue

            if msg_type == "session-login":
                token = data.get("token")
                found_user = None
                for username, tokens in sessions.items():
                    if token in tokens:
                        found_user = username
                        break

                if not found_user:
                    await websocket.send(json.dumps({
                        "type": "auth-error",
                        "message": "Invalid or expired session"
                    }))
                    continue

                user_tokens = sessions.get(found_user, {})
                any_active = any(t in connected_websockets for t in user_tokens)

                if any_active:
                    try:
                        await websocket.send(json.dumps({
                            "type": "duplicate-session"
                        }))
                    except:
                        pass
                    await websocket.close()
                    continue

                connected_websockets[token] = websocket
                if found_user not in verified:
                    verified.append(found_user)
                await websocket.send(json.dumps({
                    "type": "login-success",
                    "token": token,
                    "username": found_user
                }))
                await websocket.send(json.dumps({
                    "type": "user-settings",
                    "settings": users_db.get(found_user, {}).get("settings", {})
                }))
                await notify_users()
                save_sessions()
                continue

            if msg_type == "logout":
                nick = users.get(websocket, {}).get("nick")
                if nick in sessions:
                    tokens_to_remove = [t for t, ws in connected_websockets.items() if ws == websocket and t in sessions[nick]]
                    for t in tokens_to_remove:
                        connected_websockets.pop(t, None)
                        sessions[nick].pop(t, None)
                    if not sessions[nick]:
                        sessions.pop(nick)
                    if nick in verified:
                        verified.remove(nick)
                await websocket.send(json.dumps({"type": "logged-out"}))
                save_sessions()
                await notify_users()
                continue

            if msg_type == "save-favorites":
                username = data.get("username")
                favorites = data.get("favorites", [])
                users_db[username]["favorites"] = favorites
                save_users(users_db)
                continue

            if msg_type == "get-favorites":
                username = data.get("username")
                favorites = users_db.get(username, {}).get("favorites", [])
                await websocket.send(json.dumps({
                    "type": "user-favorites",
                    "favorites": favorites
                }))
                continue
            
            if msg_type == "join":
                peer_ip = websocket.remote_address[0]
                if peer_ip == "localhost":
                    await websocket.send(json.dumps({"type": "IP", "ip": SERVER_IP, "muted": list(muted), "verified": verified}))
                    continue
                new_nick = get_unique_nick(nick, data.get("Force", False))
                is_admin = peer_ip == SERVER_IP or (SERVER_IP == "127.0.0.1" and peer_ip in ("127.0.0.1", "localhost"))
                
                color = random.choice(COLOR_PALETTE)
                if new_nick in users_db and "settings" in users_db[new_nick] and "color" in users_db[new_nick]["settings"]:
                    color = users_db[new_nick]["settings"]["color"]
                else:
                    color = random.choice(COLOR_PALETTE)

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
                await websocket.send(json.dumps({"type": "IP", "ip": SERVER_IP, "is_admin": is_admin, "muted": list(muted), "verified": verified}))
                await websocket.send(json.dumps({
                    "type": "history-available",
                    "available": bool(chat_history)
                }))
                if LoggAllowed:
                    timestamp = datetime.now().strftime("%Y-%m-%d  %H_%M  %S")
                    ip_log_path = os.path.join("../Logs", "IpLogs", f"{peer_ip}.txt")
                    with open(ip_log_path, "a", encoding="utf-8") as ip_log:
                        ip_log.write(f"!!Joined     | {timestamp} | Nick: {new_nick} \n")
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
                                if LoggAllowed:
                                    timestamp = datetime.now().strftime("%Y-%m-%d  %H_%M  %S")
                                    ip_log_path = os.path.join("../Logs", "IpLogs", f"{ban_ip}.txt")
                                    with open(ip_log_path, "a", encoding="utf-8") as ip_log:
                                        ip_log.write(f"!!Banned     | {timestamp} | Nick: {users[websocket]['nick']} \n")
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
                                if LoggAllowed:
                                    timestamp = datetime.now().strftime("%Y-%m-%d  %H_%M  %S")
                                    peer_ip = websocket.remote_address[0]
                                    ip_log_path = os.path.join("../Logs", "IpLogs", f"{peer_ip}.txt")
                                    with open(ip_log_path, "a", encoding="utf-8") as ip_log:
                                        ip_log.write(f"!!Kicked     | {timestamp} | Nick: {users[websocket]['nick']} \n")
                                await ws.send(json.dumps({"type": "kicked", "reason": "kicked"}))
                                await ws.close()
                                break

            if websocket not in users:
                continue

            if msg_type == "color":
                now = datetime.now().timestamp()
                last_change = last_color_change.get(websocket, 0)
                if now - last_change < COLOR_COOLDOWN:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": f"Please wait {COLOR_COOLDOWN} seconds before changing color again."
                    }))
                    continue
                color = data.get("color", "#28a745")
                if check_For_Barteks_Niggerness(color):
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": "This color is too similar to the background. Please choose another."
                    }))
                    continue
                users[websocket]["color"] = color
                last_color_change[websocket] = now
                await notify_users()
                continue
            
            if msg_type == "save-settings":
                username = data.get("username")
                color = data.get("color")
                if username in users_db:
                    users_db[username]["color"] = color
                    save_users(users_db)
                    await websocket.send(json.dumps({"type": "settings-saved"}))
                else:
                    await websocket.send(json.dumps({"type": "error", "message": "User not found"}))
                continue

            if msg_type == "change-password":
                username = data.get("username")
                old_pw = data.get("old_password")
                new_pw = data.get("new_password")
                if username in users_db and users_db[username]["password"] == old_pw:
                    users_db[username]["password"] = new_pw
                    save_users(users_db)
                    await websocket.send(json.dumps({"type": "password-changed"}))
                else:
                    await websocket.send(json.dumps({"type": "error", "message": "Invalid credentials"}))
                continue

            if msg_type == "get-sessions":
                username = data.get("username")
                user_sessions = []
                current_token = None
                for token, ws in connected_websockets.items():
                    if ws == websocket:
                        current_token = token
                        break
                for token, info in sessions.get(username, {}).items():
                    user_sessions.append({
                        "token": token,
                        "ip": info.get("ip", "unknown"),
                        "timestamp": info.get("timestamp", "unknown"),
                        "current": token == current_token
                    })
                await websocket.send(json.dumps({"type": "sessions-list", "sessions": user_sessions}))
                continue

            if msg_type == "logout-session":
                username = data.get("username")
                token = data.get("token")
                if token in sessions.get(username, {}):
                    ws = connected_websockets.get(token)
                    if ws:
                        await ws.send(json.dumps({"type": "kicked", "reason": "logged-out"}))
                        await ws.close()
                    sessions[username].pop(token)
                    connected_websockets.pop(token, None)
                    save_sessions()
                    await websocket.send(json.dumps({"type": "session-logged-out", "token": token}))
                else:
                    await websocket.send(json.dumps({"type": "error", "message": "Session not found"}))
                continue

            if msg_type == "message":
                if users[websocket]["nick"] in muted:
                    continue
                text = data.get("text", "")
                timestamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
                reply_to = data.get("replyTo")
                msg_obj = {
                    "type": "message",
                    "nick": users[websocket]["nick"],
                    "color": users[websocket]["color"],
                    "text": text,
                    "timestamp": timestamp
                }
                if reply_to:
                    msg_obj["replyTo"] = reply_to
                if LoggAllowed:
                    timestamp = datetime.now().strftime("%Y-%m-%d  %H_%M  %S")
                    peer_ip = websocket.remote_address[0]
                    logging.info(f"IP: {peer_ip} | Nick: {users[websocket]['nick']} | Message: {text}")
                    ip_log_path = os.path.join("../Logs", "IpLogs", f"{peer_ip}.txt")
                    with open(ip_log_path, "a", encoding="utf-8") as ip_log:
                        ip_log.write(f"{timestamp} | Nick: {users[websocket]['nick']} | Message: {text}\n")
                final = json.dumps(msg_obj)
                chat_history.append(msg_obj)
                if len(chat_history) > 200:
                    chat_history.pop(0)
                await asyncio.gather(*[asyncio.create_task(client.send(final)) for client in clients])
    except:
        pass
    finally:
        if LoggAllowed:
            timestamp = datetime.now().strftime("%Y-%m-%d  %H_%M  %S")
            peer_ip = websocket.remote_address[0]
            nick = users.get(websocket, {}).get("nick")
            logging.info(f"Leaving | IP: {peer_ip} | Nick: {nick}")
            ip_log_path = os.path.join("../Logs", "IpLogs", f"{peer_ip}.txt")
            with open(ip_log_path, "a", encoding="utf-8") as ip_log:
                ip_log.write(f"!!Leaving       | {timestamp} | Nick: {nick}\n")

        nick = users.get(websocket, {}).get("nick")
        if nick in verified:
            verified.remove(nick)
        users.pop(websocket, None)
        clients.discard(websocket)
        tokens_to_remove = [t for t, ws in connected_websockets.items() if ws == websocket]
        for t in tokens_to_remove:
            connected_websockets.pop(t, None)
            for username, tokens in list(sessions.items()):
                if t in tokens:
                    tokens.remove(t)
                    if not tokens:
                        sessions.pop(username)
                    break

        save_sessions()
        await notify_users()

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
    def send_no_cache_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
    def do_GET(self):
        if self.path == "/file-list":
            files = [
                fname for fname in os.listdir("uploads")
                if os.path.isfile(os.path.join("uploads", fname))
            ]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_no_cache_headers()
            self.end_headers()
            self.wfile.write(json.dumps(files).encode("utf-8"))
            return

        if self.path.startswith("/uploads/"):
            file_path = os.path.normpath(unquote(self.path.lstrip("/")))
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

        if self.path in ("/", "/index.html"):
            with open("index.html", "r", encoding="utf-8") as f:
                content = f.read()
            content = content.replace(
                "<title>LAN CHAT</title>",
                f"<title>LAN CHAT - {SERVER_IP}</title>"
            )
            self.send_response(200)
            self.send_header("Content-type", "text/html; charset=utf-8")
            self.send_no_cache_headers()
            self.end_headers()
            self.wfile.write(content.encode("utf-8"))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/upload":
            content_length = int(self.headers.get('Content-Length', 0))
            content_type = self.headers.get('Content-Type', "")
            if "multipart/form-data" not in content_type:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Invalid content type")
                return

            body = self.rfile.read(content_length)
            headers = f"Content-Type: {content_type}\r\n\r\n".encode() + body
            msg = BytesParser(policy=default_policy).parsebytes(headers)

            if not msg.is_multipart():
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"No file uploaded")
                return

            for part in msg.iter_parts():
                if part.get_filename():
                    filename = os.path.basename(part.get_filename())
                    filepath = os.path.join("uploads", filename)
                    base, ext = os.path.splitext(filename)
                    i = 1
                    while os.path.exists(filepath):
                        filename = f"{base}_{i}{ext}"
                        filepath = os.path.join("uploads", filename)
                        i += 1
                    with open(filepath, "wb") as f:
                        f.write(part.get_payload(decode=True))
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(filename.encode())
                    return

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
