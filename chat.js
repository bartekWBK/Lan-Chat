let currentUsers = [];
let userColors = {};
let nick = "";
let IP = "";
let is_admin = false;

const ws = new WebSocket(`ws://${location.hostname}:6789`);
console.log("v: 1.3.1");

const chat = document.getElementById("chat");
const msg = document.getElementById("msg");
const send = document.getElementById("send");
const code = document.getElementById("code");
const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const toggleTimestamps = document.getElementById("toggle-timestamps");
const toggleFileLinks = document.getElementById("toggle-file-links");
const userList = document.getElementById("users");
const darkModeToggle = document.getElementById("toggle-darkmode");
const fileListDiv = document.getElementById("file-list");
const fileInput = document.getElementById("fileInput");
const sendFileBtn = document.getElementById("sendFileBtn");
const fileUploadLabel = document.querySelector(".file-upload-label");
const togglePostFiles = document.getElementById("toggle-post-files");
const fileUploadControls = document.getElementById("file-upload-controls");
const clearFilesBtn = document.getElementById("clear-files-btn");
const customNickColorInput = document.getElementById("custom-nick-color");

let showTimestamps = true;
let showFileLinks = false;
let isAlive = true;
let customNickColor = localStorage.getItem("customNickColor") || "";

function isAdmin() {
  return is_admin;
}

function getUserColor(nick) {
  const colors = [
    "#007bff", "#28a745", "#e83e8c", "#fd7e14", "#20c997",
    "#6f42c1", "#dc3545", "#17a2b8", "#ffc107", "#6610f2",
    "#b8860b", "#ff1493", "#00ced1", "#ff6347", "#4682b4",
    "#8a2be2", "#ff4500", "#228b22", "#00bfff", "#ff69b4"
  ];
  let hash = 5381;
  for (let i = 0; i < nick.length; i++) {
    hash = ((hash << 5) + hash) + nick.charCodeAt(i);
  }
  return colors[Math.abs(hash) % colors.length];
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return "[Invalid time]";
  }
}

function promptForNick() {
  let input;
  do {
    input = prompt("Enter your nickname:")?.trim();
  } while (!input);
  return input;
}

msg.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
send.onclick = sendMessage;

function sendMessage() {
  const text = msg.value;
  if (!text.trim()) return;
  ws.send(JSON.stringify({ type: "message", nick, text }));
  msg.value = "";
}

code.onclick = () => {
  const selected = msg.value.slice(msg.selectionStart, msg.selectionEnd);
  const wrapped = "```\n" + (selected || msg.value) + "\n```";
  ws.send(JSON.stringify({ type: "message", nick, text: wrapped }));
  msg.value = "";
};

ws.onopen = () => {
  if (location.hostname != "localhost") {
    nick = promptForNick();
    ws.send(JSON.stringify({ type: "join", nick }));
  }else{
    ws.send(JSON.stringify({ type: "join", nick }));
  }
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "nick-update") {
    nick = data.nick;
  }
  if (data.type === "unmuted") {
    alert("You have been unmuted by the admin. You can send messages again.");
    msg.disabled = false;
    send.disabled = false;
  }
  if (data.type === "message") {
    const div = document.createElement("div");
    div.dataset.timestamp = data.timestamp;
    div.dataset.original = JSON.stringify(data);
    div.innerHTML = formatMessage(data);
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    if (
      data.text.startsWith("📎 <a href=") &&
      toggleFileLinks.checked &&
      fileListDiv.style.display !== "none"
    ) {
      fetchFileList();
    }
  }
  if (data.type === "pong") {
    isAlive = true;
    return;
  }
  if (data.type === "files-cleared") {
    if (toggleFileLinks.checked && fileListDiv.style.display !== "none") {
      fetchFileList();
    }
  }
  if (data.type === "IP") {
    const ip = document.getElementById("LAN");
    if (ip) ip.innerHTML = `LAN chat - ${data.ip}:8000`;
    IP = data.ip;
    if (location.hostname === "localhost") {
      window.location.href = `http://${data.ip}:8000`;
    }
    is_admin = data.is_admin || false;
    updateClearFilesBtn();

    if (currentUsers.length > 0) {
      userList.innerHTML = "";
      let myColor = null;
      currentUsers.forEach(user => {
        userColors[user.nick] = user.color;
        if (user.nick === nick) myColor = user.color;
        const li = document.createElement("li");
        li.textContent = user.nick;
        if (user.color) li.style.color = user.color;
        if (user.nick === nick) li.style.fontWeight = "bold";
        if (isAdmin() && user.nick !== nick) {
          const muteBtn = document.createElement("button");
          muteBtn.textContent = "🔇";
          muteBtn.title = "Mute";
          muteBtn.className = "user-action-btn";
          muteBtn.onclick = (e) => {
            e.stopPropagation();
            ws.send(JSON.stringify({ type: "admin", action: "mute", user: user.nick }));
          };
          li.appendChild(muteBtn);

          const unmuteBtn = document.createElement("button");
          unmuteBtn.textContent = "🔊";
          unmuteBtn.title = "Unmute";
          unmuteBtn.className = "user-action-btn";
          unmuteBtn.onclick = (e) => {
            e.stopPropagation();
            ws.send(JSON.stringify({ type: "admin", action: "unmute", user: user.nick }));
          };
          li.appendChild(unmuteBtn);

          const kickBtn = document.createElement("button");
          kickBtn.textContent = "🚫";
          kickBtn.title = "Kick";
          kickBtn.className = "user-action-btn";
          kickBtn.onclick = (e) => {
            e.stopPropagation();
            ws.send(JSON.stringify({ type: "admin", action: "kick", user: user.nick }));
          };
          li.appendChild(kickBtn);
        }
        userList.appendChild(li);
      });
      if (myColor && customNickColorInput) {
        customNickColorInput.value = myColor;
      }
      [...chat.children].forEach(div => {
        const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
        if (originalData) {
          div.innerHTML = formatMessage(originalData);
        }
      });
    }
  }
  if (data.type === "muted") {
    alert("You have been muted by the admin. You cannot send messages.");
    msg.disabled = true;
    send.disabled = true;
  }
  if (data.type === "kicked") {
    alert("You have been kicked by the admin.");
    window.location.reload();
  }
  if (data.type === "users") {
    currentUsers = data.users || [];
    userColors = {};
    userList.innerHTML = "";
    let myColor = null;
    currentUsers.forEach(user => {
      userColors[user.nick] = user.color;
      if (user.nick === nick) myColor = user.color;
      const li = document.createElement("li");
      li.textContent = user.nick;
      if (user.color) li.style.color = user.color;
      if (user.nick === nick) li.style.fontWeight = "bold";

      if (isAdmin() && user.nick !== nick) {
        const muteBtn = document.createElement("button");
        muteBtn.textContent = "🔇";
        muteBtn.title = "Mute";
        muteBtn.className = "user-action-btn";
        muteBtn.onclick = (e) => {
          e.stopPropagation();
          ws.send(JSON.stringify({ type: "admin", action: "mute", user: user.nick }));
        };
        li.appendChild(muteBtn);

        const unmuteBtn = document.createElement("button");
        unmuteBtn.textContent = "🔊";
        unmuteBtn.title = "Unmute";
        unmuteBtn.className = "user-action-btn";
        unmuteBtn.onclick = (e) => {
          e.stopPropagation();
          ws.send(JSON.stringify({ type: "admin", action: "unmute", user: user.nick }));
        };
        li.appendChild(unmuteBtn);

        const kickBtn = document.createElement("button");
        kickBtn.textContent = "🚫";
        kickBtn.title = "Kick";
        kickBtn.className = "user-action-btn";
        kickBtn.onclick = (e) => {
          e.stopPropagation();
          ws.send(JSON.stringify({ type: "admin", action: "kick", user: user.nick }));
        };
        li.appendChild(kickBtn);
      }
      userList.appendChild(li);
    });
    if (myColor && customNickColorInput) {
      customNickColorInput.value = myColor;
    }
    [...chat.children].forEach(div => {
      const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (originalData) {
        div.innerHTML = formatMessage(originalData);
      }
    });
    updateClearFilesBtn();
  }
};

function fetchFileList() {
  fetch("/file-list")
    .then(res => res.json())
    .then(files => {
      const ul = document.getElementById("uploaded-files");
      if (!ul) return;
      ul.innerHTML = ""; 
      files.forEach(fname => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `http://${IP}:8000/uploads/${encodeURIComponent(fname)}`;
        a.textContent = fname;
        a.target = "_blank";
        li.appendChild(a);
        ul.appendChild(li);
      });
    });
}

function updateClearFilesBtn() {
  if (!clearFilesBtn || !fileListDiv) return;
  clearFilesBtn.style.display = (isAdmin() && fileListDiv.style.display !== "none") ? "block" : "none";
}
if (clearFilesBtn) {
  clearFilesBtn.onclick = () => {
    if (!isAdmin()) return;
    if (confirm("Delete all uploaded files?")) {
      ws.send(JSON.stringify({ type: "admin", action: "clear-files" }));
      const ul = document.getElementById("uploaded-files");
      if (ul) ul.innerHTML = "";
    }
  };
}

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    fileUploadLabel.textContent = "📎 " + fileInput.files[0].name;
    sendFileBtn.style.display = "inline-block";
  } else {
    fileUploadLabel.textContent = "📎 Choose File";
    sendFileBtn.style.display = "none";
  }
});
sendFileBtn.style.display = "none";

togglePostFiles.addEventListener("change", () => {
  if (togglePostFiles.checked) {
    fileUploadControls.style.display = "block";
  } else {
    fileUploadControls.style.display = "none";
    fileInput.value = "";
    fileUploadLabel.textContent = "📎 Choose File";
    sendFileBtn.style.display = "none";
  }
});
fileUploadControls.style.display = togglePostFiles.checked ? "block" : "none";

function uploadFile() {
  const file = fileInput?.files[0];
  if (!file) return;

  sendFileBtn.classList.add("send-file-loading");
  sendFileBtn.disabled = true;
  sendFileBtn.innerHTML = 'Sending... <span class="spinner"></span>';

  let tracker = document.getElementById("file-upload-progress");
  if (!tracker) {
    tracker = document.createElement("div");
    tracker.id = "file-upload-progress";
    tracker.style.marginLeft = "10px";
    tracker.style.fontSize = "0.95em";
    tracker.style.color = "#007bff";
    sendFileBtn.parentNode.appendChild(tracker);
  }
  tracker.textContent = "0 / " + formatBytes(file.size) + " sent";

  const formData = new FormData();
  formData.append("file", file);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload");

  xhr.upload.onprogress = function (e) {
    if (e.lengthComputable) {
      if (e.loaded < e.total) {
        tracker.textContent = `${formatBytes(e.loaded)} / ${formatBytes(e.total)} sent`;
      } else {
        tracker.textContent = `${formatBytes(e.total)} / ${formatBytes(e.total)} sent (processing...)`;
      }
    }
  };

  xhr.onload = async function () {
    sendFileBtn.classList.remove("send-file-loading");
    sendFileBtn.disabled = false;
    sendFileBtn.innerHTML = "Send File";
    tracker.textContent = "";
    if (xhr.status === 200) {
      const savedName = xhr.responseText;
      const url = `http://${IP}:8000/uploads/${encodeURIComponent(savedName)}`;
      ws.send(JSON.stringify({ type: "message", nick, text: `📎 <a href="${url}" target="_blank">${file.name}</a>` }));
      fileInput.value = ""; 
      fileUploadLabel.textContent = "📎 Choose File";
      sendFileBtn.style.display = "none";
      if (toggleFileLinks.checked && fileListDiv.style.display !== "none") fetchFileList();
      updateClearFilesBtn();
    } else {
      alert("Failed to upload file");
    }
  };

  xhr.onerror = function () {
    sendFileBtn.classList.remove("send-file-loading");
    sendFileBtn.disabled = false;
    sendFileBtn.innerHTML = "Send File";
    tracker.textContent = "";
    alert("Failed to upload file");
  };

  xhr.send(formData);
}

toggleFileLinks.checked = showFileLinks;
toggleFileLinks.addEventListener("change", () => {
  showFileLinks = toggleFileLinks.checked;
  fileListDiv.style.display = showFileLinks ? "block" : "none";
  if (showFileLinks) fetchFileList();
  updateClearFilesBtn();
});
if (toggleFileLinks.checked) {
  fileListDiv.style.display = "block";
  fetchFileList();
  updateClearFilesBtn();
}

if (customNickColor) {
  customNickColorInput.value = customNickColor;
}
customNickColorInput.addEventListener("input", () => {
  customNickColor = customNickColorInput.value;
  localStorage.setItem("customNickColor", customNickColor);
  ws.send(JSON.stringify({ type: "color", color: customNickColor }));
  [...chat.children].forEach(div => {
    const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
    if (originalData) {
      div.innerHTML = formatMessage(originalData);
    }
  });
});

function formatMessage(data) {
  let timestamp = showTimestamps && data.timestamp
    ? `<span class="timestamp">[${formatTime(data.timestamp)}]</span> `
    : "";

  const text = data.text;
  const nickColor =
    (userColors && userColors[data.nick]) ||
    (data.nick === nick && customNickColor) ||
    getUserColor(data.nick);
  const nickHtml = `<span class="chat-nick" style="color:${nickColor}">${escapeHtml(data.nick)}</span>:`;

  const fileLinkMatch = text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>$/);
  if (fileLinkMatch) {
    const url = fileLinkMatch[1];
    const filename = fileLinkMatch[2];
    return `${timestamp}${nickHtml}
      <div class="file-card">
        <span class="file-icon">📄</span>
        <span class="file-name">${escapeHtml(filename)}</span>
        <button class="file-download-btn" onclick="downloadFileWithProgress('${url}', '${escapeHtml(filename)}')">Download</button>
        <div class="download-progress" id="download-progress-${escapeHtml(filename)}" style="display:none;margin-top:4px;font-size:0.95em;color:#28a745;"></div>
      </div>`;
  }

  if (/^```([\s\S]*?)```$/.test(text.trim())) {
    const code = text.trim().replace(/^```([\s\S]*?)```$/, "$1");
    return `${timestamp}${nickHtml}
      <div class="code-block" style="position: relative; padding-bottom: 2em; margin: 8px 0;">
        <pre class="code-raw">${escapeHtml(code)}</pre>
        <button class="copy-btn" title="Copy code" style="position: absolute; bottom: 5px; right: 5px; font-size: 0.75em; padding: 3px 6px;">Copy</button>
      </div>`;
  }

  let processed = text;
  const codeBlocks = [];
  processed = processed.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `___CODEBLOCK${codeBlocks.length - 1}___`;
  });

  const links = [];
  if (showFileLinks) {
    processed = processed.replace(/<a\s+[^>]+>(.*?)<\/a>/gi, (match) => {
      links.push(match);
      return `___LINK${links.length - 1}___`;
    });
  }

  processed = escapeHtml(processed);
  processed = processed.replace(/___LINK(\d+)___/g, (_, i) => links[i]);
  processed = processed.replace(/___CODEBLOCK(\d+)___/g, (_, i) => {
    const escapedCode = escapeHtml(codeBlocks[i]);
    return `
      <div class="code-block" style="position: relative; padding-bottom: 2em; margin: 8px 0;">
        <pre><code>${escapedCode}</code></pre>
        <button class="copy-btn" title="Copy code" style="position: absolute; bottom: 5px; right: 5px; font-size: 0.75em; padding: 3px 6px;">Copy</button>
      </div>
    `;
  });

  return `${timestamp}${nickHtml} ${processed}`;
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('copy-btn')) {
    const codeElem = e.target.closest('.code-block')?.querySelector('code, pre');
    if (!codeElem) return;

    const textToCopy = codeElem.innerText || codeElem.textContent;
    const button = e.target;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        button.textContent = 'Copied!';
        setTimeout(() => button.textContent = 'Copy', 1500);
      }).catch(() => {
        fallbackCopyText(textToCopy, button);
      });
    } else {
      fallbackCopyText(textToCopy, button);
    }
  }
});

function fallbackCopyText(text, button) {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (successful) {
      button.textContent = 'Copied!';
    } else {
      button.textContent = 'Failed';
    }
  } catch {
    button.textContent = 'Failed';
  }

  setTimeout(() => button.textContent = 'Copy', 1500);
}

document.body.classList.add("dark");
darkModeToggle.checked = document.body.classList.contains("dark");

darkModeToggle.addEventListener("change", () => {
  if (darkModeToggle.checked) {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }
  settingsPanel.style.color = darkModeToggle.checked ? "#eee" : "#333";
});
settingsPanel.style.color = document.body.classList.contains("dark") ? "#eee" : "#333";

toggleTimestamps.checked = showTimestamps;
toggleTimestamps.onchange = () => {
  showTimestamps = toggleTimestamps.checked;
  [...chat.children].forEach(div => {
    const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
    if (originalData) {
      div.innerHTML = formatMessage(originalData);
    }
  });
};

window.downloadFileWithProgress = function(url, filename) {
  const progressId = `download-progress-${filename}`;
  let progressDiv = document.getElementById(progressId);
  if (!progressDiv) {
    progressDiv = document.createElement("div");
    progressDiv.id = progressId;
    document.body.appendChild(progressDiv);
  }
  progressDiv.style.display = "block";
  progressDiv.textContent = "Starting download...";

  fetch(url)
    .then(response => {
      if (!response.ok) throw new Error("Network response was not ok");
      const contentLength = response.headers.get('content-length');
      if (!contentLength) {
        progressDiv.textContent = "Downloading...";
      }
      const total = parseInt(contentLength, 10);
      let loaded = 0;
      const reader = response.body.getReader();
      let chunks = [];
      function read() {
        return reader.read().then(({done, value}) => {
          if (done) {
            const blob = new Blob(chunks);
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            progressDiv.textContent = "Download complete!";
            setTimeout(() => progressDiv.style.display = "none", 1500);
            return;
          }
          chunks.push(value);
          loaded += value.length;
          if (total) {
            progressDiv.textContent = `${formatBytes(loaded)} / ${formatBytes(total)} downloaded`;
          } else {
            progressDiv.textContent = `${formatBytes(loaded)} downloaded`;
          }
          return read();
        });
      }
      return read();
    })
    .catch(err => {
      progressDiv.textContent = "Download failed!";
      setTimeout(() => progressDiv.style.display = "none", 2000);
    });
};

let i = setInterval(() => {
  if (!isAlive) {
    const div = document.createElement("div");
    div.innerHTML = `<span style="color: red;"><b>⚠️ Połączenie z serwerem zostało utracone.</b></span>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    clearInterval(i);
    alert("🚫 Disconnected from server. The server may be offline.");
    location.reload();
    return;
  }
  isAlive = false;
  try {
    ws.send(JSON.stringify({ type: "ping" }));
  } catch (e) {
    const div = document.createElement("div");
    div.innerHTML = `<span style="color: red;"><b>⚠️ Serwer nie odpowiada.</b></span>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }
}, 5000);

settingsBtn.onclick = () => {
  settingsPanel.style.display = settingsPanel.style.display === "none" ? "block" : "none";
};
