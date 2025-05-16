import asyncio
import json
import websockets
import socket
from http.server import SimpleHTTPRequestHandler, HTTPServer
import threading
from datetime import datetime, timezone
import cgi
import os

clients = set()
users = dict()
os.makedirs("uploads", exist_ok=True)

async def notify_users():
    user_list = list(users.values())
    message = json.dumps({"type": "users", "users": user_list})
    if clients:
        await asyncio.gather(*[asyncio.create_task(client.send(message)) for client in clients])
    
def get_unique_nick(base_nick):
    existing = set(users.values())
    if base_nick not in existing:
        return base_nick
    i = 1
    while f"{base_nick}_{i}" in existing:
        i += 1
    return f"{base_nick}_{i}"



async def chat_handler(websocket):
    clients.add(websocket)
    try:
        async for message in websocket:
            data = json.loads(message)
            nick = data.get("nick", "Unknown")
            msg_type = data.get("type")

            if msg_type == "join":
                new_nick = get_unique_nick(nick)
                users[websocket] = new_nick  
                await notify_users()
                await websocket.send(json.dumps({"type": "nick-update", "nick": new_nick}))
                await websocket.send(json.dumps({"type": "IP", "ip": SERVER_IP}))
                continue  

            if websocket not in users:
                continue

            if msg_type == "message":
                print(SERVER_IP)
                text = data.get("text", "")
                timestamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
                final = json.dumps({
                    "type": "message",
                    "nick": users[websocket],  
                    "text": text,
                    "timestamp": timestamp
                })
                await asyncio.gather(*[asyncio.create_task(client.send(final)) for client in clients])
    except:
        pass
    finally:
        clients.discard(websocket)
        users.pop(websocket, None)
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

import os  # Make sure this is at the top of your file

class CustomHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Force download for any file in /uploads/
        if self.path.startswith("/uploads/"):
            file_path = self.path.lstrip("/")
            file_path = os.path.normpath(file_path)
            if os.path.exists(file_path):
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Disposition", f'attachment; filename="{os.path.basename(file_path)}"')
                self.end_headers()
                with open(file_path, "rb") as f:
                    self.wfile.write(f.read())
                return
            else:
                self.send_error(404, "File not found")
                return

        # Modify index.html to inject IP
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
            content_type = self.headers.get('Content-Type')
            if not content_type:
                self.send_error(400, "Content-Type header missing")
                return

            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': content_type}
            )

            file_item = form["file"]
            if file_item.filename:
                filename = os.path.basename(file_item.filename)
                save_path = os.path.join("uploads", filename)
                with open(save_path, "wb") as f:
                    f.write(file_item.file.read())

                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"OK")
            else:
                self.send_error(400, "No file uploaded")


def start_http_server():
    httpd = HTTPServer(("0.0.0.0", 8000), CustomHandler)
    print("Website running at http://localhost:8000")
    httpd.serve_forever()

threading.Thread(target=start_http_server, daemon=True).start()

async def start_websocket():
    async with websockets.serve(chat_handler, "0.0.0.0", 6789):
        print("WebSocket server running at ws://localhost:6789")
        await asyncio.Future()

asyncio.run(start_websocket())
