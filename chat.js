let currentUsers = [];
let userColors = {};
let adminUsers = new Set();
let nick = "";
let IP = "";
let is_admin = false;

const ws = new WebSocket(`ws://${location.hostname}:6789`);
console.log("v: 1.4.8.5");
let lang = "javascript";
const codeLang = document.getElementById("code-lang");
const mainChat = document.getElementById("main-chat");
const chat = document.getElementById("chat");
const msg = document.getElementById("msg");
const send = document.getElementById("send");
const code = document.getElementById("code");
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
let deletedFiles = new Set();
if (localStorage.getItem("showTimestamps") === null) {
  localStorage.setItem("showTimestamps", "true");
}
let showTimestamps = localStorage.getItem("showTimestamps") === "true";let showFileLinks = localStorage.getItem("showFileLinks") === "true";
let customNickColor = localStorage.getItem("customNickColor") || "";
let isAlive = true;

if (localStorage.getItem("showReplyBtn") === null) {
  localStorage.setItem("showReplyBtn", "false");
}
let showReplyBtn = localStorage.getItem("showReplyBtn") === "true";
const toggleReplyBtn = document.getElementById("toggle-reply-btn");
if (toggleReplyBtn) toggleReplyBtn.checked = showReplyBtn;

if (toggleReplyBtn) {
  toggleReplyBtn.addEventListener("change", () => {
    showReplyBtn = toggleReplyBtn.checked;
    localStorage.setItem("showReplyBtn", showReplyBtn);
    [...chat.children].forEach(div => {
      const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (originalData) {
        div.innerHTML = formatMessage(originalData);
      }
    });
  });
}

function showError(msg) {
  const box = document.getElementById("error-message");
  if (!box) return;
  box.textContent = msg;
  box.style.display = "block";
  setTimeout(() => {
    box.style.display = "none";
  }, 4000);
}

function createFileElement(filename, url) {
  const fileExt = filename.split('.').pop().toLowerCase();
  const previewEnabled = document.getElementById("toggle-image-preview")?.checked;

  const container = document.createElement("div");
  container.classList.add("file-card");

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.textContent = filename;
  link.classList.add("file-download-btn");
  container.appendChild(link);

  if (previewEnabled && ["jpg", "jpeg", "png", "gif", "webp"].includes(fileExt)) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = filename;
    img.style.maxWidth = "200px";
    img.style.maxHeight = "200px";
    img.style.display = "block";
    img.style.marginTop = "8px";
    img.style.borderRadius = "6px";
    img.style.cursor = "pointer";

    img.addEventListener("click", () => {
      window.downloadFileWithProgress(url, filename);
    });

    container.appendChild(img);
  }

  return container;
}
function isChatAtBottom(threshold = 60) {
  return (chat.scrollHeight - chat.scrollTop - chat.clientHeight) < threshold;
}

document.addEventListener("DOMContentLoaded", () => {
  showTimestamps = localStorage.getItem("showTimestamps") === "true";
  showFileLinks = localStorage.getItem("showFileLinks") === "true";
  customNickColor = localStorage.getItem("customNickColor") || "";
  toggleTimestamps.checked = showTimestamps;
  toggleFileLinks.checked = showFileLinks;
  if (mainChat) {
    mainChat.style.maxWidth = fileListDiv.style.display !== "none"
      ? "calc(100% - 420px)"
      : "calc(100% - 220px)";
  }
  if (customNickColor) customNickColorInput.value = customNickColor;
  togglePostFiles.checked = localStorage.getItem("togglePostFiles") === "true";
  fileUploadControls.style.display = togglePostFiles.checked ? "block" : "none";
  darkModeToggle.checked = localStorage.getItem("darkMode") !== "false";
  if (darkModeToggle.checked) document.body.classList.add("dark");
  else document.body.classList.remove("dark");

  fileInput.value = "";
  fileUploadLabel.textContent = "📎 Choose File";
  sendFileBtn.style.display = "none";

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      fileUploadLabel.textContent = "📎 " + fileInput.files[0].name;
      sendFileBtn.style.display = "inline-block";
    } else {
      fileUploadLabel.textContent = "📎 Choose File";
      sendFileBtn.style.display = "none";
    }
  });

  togglePostFiles.addEventListener("change", () => {
    localStorage.setItem("togglePostFiles", togglePostFiles.checked);
    fileUploadControls.style.display = togglePostFiles.checked ? "block" : "none";
    if (!togglePostFiles.checked) {
      fileInput.value = "";
      fileUploadLabel.textContent = "📎 Choose File";
      sendFileBtn.style.display = "none";
    }
  });

  toggleTimestamps.onchange = () => {
    showTimestamps = toggleTimestamps.checked;
    localStorage.setItem("showTimestamps", showTimestamps);
    [...chat.children].forEach(div => {
      const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (originalData) {
        div.innerHTML = formatMessage(originalData);
      }
    });
    if (window.Prism) Prism.highlightAll();
  };

  toggleFileLinks.addEventListener("change", () => {
    showFileLinks = toggleFileLinks.checked;
    localStorage.setItem("showFileLinks", showFileLinks);
    fileListDiv.style.display = showFileLinks ? "block" : "none";
    if (showFileLinks) fetchFileList();
    updateClearFilesBtn();
    if (mainChat) {
      mainChat.style.maxWidth = fileListDiv.style.display !== "none"
        ? "calc(100% - 420px)"
        : "calc(100% - 220px)";
    }
    // settingsPanel.style.color = document.body.classList.contains("dark") ? "#eee" : "#333";
  });


let setColorBtn = document.getElementById("set-color-btn");
let colorInput = document.getElementById("custom-nick-color");

if (setColorBtn) {
  setColorBtn.addEventListener("click", () => {
    const color = colorInput.value;
    customNickColor = customNickColorInput.value;
    localStorage.setItem("customNickColor", customNickColor);
    ws.send(JSON.stringify({ type: "color", color }));
    [...chat.children].forEach(div => {
      const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (originalData) {
        div.innerHTML = formatMessage(originalData);
      }
    });
    if (window.Prism) {
      setTimeout(() => Prism.highlightAll(), 500);
    }
    if (setColorBtn) {
      setColorBtn.disabled = true;
      setColorBtn.style.opacity = "0.5";
      setTimeout(() => {
        setColorBtn.disabled = false;
        setColorBtn.style.opacity = "1";
      }, 5000); 
    }
  });
}




  // customNickColorInput.addEventListener("input", () => {
  //   customNickColor = customNickColorInput.value;
  //   localStorage.setItem("customNickColor", customNickColor);
  //   ws.send(JSON.stringify({ type: "color", color: customNickColor }));
  //   [...chat.children].forEach(div => {
  //     const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
  //     if (originalData) {
  //       div.innerHTML = formatMessage(originalData);
  //     }
  //   });
  //   if (window.Prism) {
  //     setTimeout(() => Prism.highlightAll(), 500);
  //   }
  // });

  darkModeToggle.addEventListener("change", () => {
    localStorage.setItem("darkMode", darkModeToggle.checked);
    if (darkModeToggle.checked) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
    [...chat.children].forEach(div => {
      const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (originalData) {
        div.innerHTML = formatMessage(originalData);
      }
    });

    let replyPreview = document.getElementById('reply-preview');
    if (replyPreview) {
      if (darkModeToggle.checked) {
        replyPreview.style.background = '#333';
        replyPreview.style.color = '#eee';
        replyPreview.style.border = '1px solid #555';
      } else {
        replyPreview.style.background = '#f0f0f0';
        replyPreview.style.color = '#000';
        replyPreview.style.border = '1px solid #ccc';
      }
    }
  });

  fileListDiv.style.display = showFileLinks ? "block" : "none";
  if (showFileLinks) fetchFileList();
  updateClearFilesBtn();



  // settingsPanel.style.color = document.body.classList.contains("dark") ? "#eee" : "#333";
});




const recoverBtn = document.getElementById("recover-chat-btn");
const closeRecoverBtn = document.getElementById("close-recover-btn");

if (recoverBtn) {
  recoverBtn.addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "get-history" }));
    recoverBtn.style.display = "none";
  });
}

if (closeRecoverBtn) {
  closeRecoverBtn.addEventListener("click", (e) => {
    e.stopPropagation(); 
    recoverBtn.style.display = "none";
  });
}

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
  let lastNick = localStorage.getItem("lastNick") || "";
  let input;
  do {
    input = prompt("Enter your nickname (1-16 chars):", lastNick)?.trim();
  } while (!input || input.length < 1 || input.length > 16);
  localStorage.setItem("lastNick", input);
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
  let payload = { type: "message", nick, text };
  if (msg.dataset.replyTo) {
    payload.replyTo = msg.dataset.replyTo;
  }
  ws.send(JSON.stringify(payload));
  msg.value = "";
  let replyPreview = document.getElementById('reply-preview');
  if (replyPreview) replyPreview.remove();
  msg.dataset.replyTo = "";
  setTimeout(() => {
    chat.scrollTop = chat.scrollHeight;
  }, 50)
}

code.onclick = () => {
  const selected = msg.value.slice(msg.selectionStart, msg.selectionEnd);
  const content = (selected || msg.value).trim();
  let lang = codeLang.value;
  let wrapped;
  if (lang && lang !== "plaintext") {
    wrapped = "```" + lang + "\n" + content + "```";
  } else {
    wrapped = "```plaintext\n" + content + "```";
  }
  ws.send(JSON.stringify({ type: "message", nick, text: wrapped }));
  msg.value = "";
  setTimeout(() => {
    chat.scrollTop = chat.scrollHeight;
  }, 50);
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
  if (window.Prism) Prism.highlightAll();
    if (data.type === "error") {
      const errorBox = document.getElementById("error-message");
      const setColorBtn = document.getElementById("set-color-btn");
      if (errorBox) {
        errorBox.textContent = data.message;
        errorBox.style.display = "block";
        setTimeout(() => {
          errorBox.style.display = "none";
        }, 3000); 
      }


  }
  if (data.type === "history-available") {
    if (recoverBtn) recoverBtn.style.display = data.available ? "inline-block" : "none";
    return;
  }
  if (data.type === "history") {
    chat.innerHTML = "";
    (data.messages || []).forEach(msgData => {
      const div = document.createElement("div");
      div.dataset.timestamp = msgData.timestamp;
      div.dataset.original = JSON.stringify(msgData);
      div.innerHTML = formatMessage(msgData);
      chat.appendChild(div);
    });
    chat.scrollTop = chat.scrollHeight;
    if (window.Prism) Prism.highlightAll();
    updateDeletedFilesInChat();
    return;
  }
  if (data.type === "files-cleared" || data.type === "file-deleted") {
    updateDeletedFilesInChat();
  }
  if (data.type === "file-deleted") {
      if (Array.isArray(data.files)) {
        data.files.forEach(fname => deletedFiles.add(fname));
        const ul = document.getElementById("uploaded-files");
        if (ul) {
          [...ul.children].forEach(li => {
            const a = li.querySelector("a");
            if (a && deletedFiles.has(a.textContent.replace(" (deleted)", ""))) {
              li.classList.add("file-deleted");
              a.style.textDecoration = "line-through";
              a.style.color = "#888";
              if (!a.textContent.endsWith(" (deleted)")) {
                a.textContent += " (deleted)";
              }
            }
          });
        }
        [...chat.children].forEach(div => {
        const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
        if (originalData && originalData.text && /^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>$/.test(originalData.text)) {
          const match = originalData.text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>$/);
          if (match && deletedFiles.has(match[2])) {
            div.classList.add("file-deleted");
            div.innerHTML = formatMessage(originalData, true);
          }
        }
      });
    }
  }
  if (data.type === "nick-update") {
    nick = data.nick;
    localStorage.setItem("lastNick", nick);
  }
  if (data.type === "unmuted") {
    alert("You have been unmuted by the admin. You can send messages again.");
    msg.disabled = false;
    send.disabled = false;
    ws.send(JSON.stringify({ type: "check" }));
  }
  if (data.type === "message") {
    const wasAtBottom = isChatAtBottom();
    const div = document.createElement("div");
    div.dataset.timestamp = data.timestamp;
    div.dataset.original = JSON.stringify(data);
    div.innerHTML = formatMessage(data);
    chat.appendChild(div);
    const img = div.querySelector("img");
    if (img) {
      img.onload = () => {
        if (wasAtBottom) chat.scrollTop = chat.scrollHeight;
      };
      if (img.complete && wasAtBottom) {
        chat.scrollTop = chat.scrollHeight;
      }
    } else if (wasAtBottom) {
      chat.scrollTop = chat.scrollHeight;
    }
    if (window.Prism) Prism.highlightAll();
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
  if (data.type === "kicked") {
    if (data.reason === "duplicate") {
      alert("You have been disconnected because you opened another tab with this nickname.");
    } else if (data.reason === "kicked") {
      alert("You have been kicked from the chat.");
    } else if (data.reason === "banned") {
      alert("You have been BANNED from the chat.");
    } else {
      alert("You have been kicked but idk why tbh from the chat.");
    }
    window.location.reload();
  }
  if (data.type === "IP") {
    const ip = document.getElementById("LAN");
    let mutedUsers = new Set(data.muted || []);
    if (ip) ip.innerHTML = `LAN chat - ${data.ip}:8000`;
    IP = data.ip; 
    if (location.hostname === "localhost") {
      window.location.href = `http://${data.ip}:8000`;
    }
    is_admin = data.is_admin || false;
    updateClearFilesBtn();

    const wipeBlacklistBtn = document.getElementById("wipe-blacklist-btn");
    if (is_admin && wipeBlacklistBtn) {
      wipeBlacklistBtn.style.display = "block";
      wipeBlacklistBtn.onclick = () => {
        if (confirm("Are you sure you want to remove all IP bans?")) {
          ws.send(JSON.stringify({ type: "admin", action: "wipe-blacklist" }));
          alert("All blacklisted users have been removed.");
        }
      };
    } else if (wipeBlacklistBtn) {
      wipeBlacklistBtn.style.display = "none";
    }

    if (currentUsers.length > 0) {
      userList.innerHTML = "";
      let myColor = null;
      console.log(adminUsers);
      currentUsers.forEach(user => {
        userColors[user.nick] = user.color;
        if (user.nick === nick) myColor = user.color;
        const li = document.createElement("li");
        li.textContent = user.nick;
        if (user.color) li.style.color = user.color;
        if (user.nick === nick) li.style.fontWeight = "bold";
        if (mutedUsers.has(user.nick)) {
          const mutedIcon = document.createElement("span");
          mutedIcon.textContent = "🔇";
          mutedIcon.title = "Muted";
          mutedIcon.style.marginRight = "4px";
          li.insertBefore(mutedIcon, li.firstChild);
        }
        if (adminUsers.has(user.nick)) {
          const adminIcon = document.createElement("span");
          adminIcon.textContent = "🛡️";
          adminIcon.title = "Admin";
          adminIcon.style.marginRight = "4px";
          li.insertBefore(adminIcon, li.firstChild);
        }
        if (is_admin && user.nick !== nick) {
          const moreBtn = document.createElement("button");
          moreBtn.textContent = "⋮";
          moreBtn.title = "More options";
          moreBtn.className = "user-action-btn more-options-btn";
          moreBtn.onclick = (e) => {
            e.stopPropagation();
            // Remove any existing menu
            document.querySelectorAll('.admin-user-menu').forEach(el => el.remove());
            // Create menu
            const menu = document.createElement("div");
            menu.className = "admin-user-menu";
            menu.style.position = "absolute";
            menu.style.left = (li.getBoundingClientRect().left - 110) + "px";
            menu.style.top = (li.getBoundingClientRect().top + window.scrollY) + "px";
            menu.innerHTML = `
              <button class="user-action-btn" data-action="mute">🔇 Mute</button>
              <button class="user-action-btn" data-action="unmute">🔊 Unmute</button>
              <button class="user-action-btn" data-action="kick">🚫 Kick</button>
              <button class="user-action-btn" data-action="ban">⛔ Ban (IP)</button>
            `;
            document.body.appendChild(menu);

            // Handle menu actions
            menu.onclick = (evt) => {
              evt.stopPropagation();
              const action = evt.target.dataset.action;
              if (action) {
                if (action === "ban") {
                  ws.send(JSON.stringify({ type: "admin", action: "ban", user: user.nick }));
                } else {
                  ws.send(JSON.stringify({ type: "admin", action, user: user.nick }));
                }
                menu.remove();
              }
            };

            // Close menu on outside click
            document.addEventListener("mousedown", function handler(ev) {
              if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener("mousedown", handler);
              }
            });
          };
          li.style.position = "relative";
          li.insertBefore(moreBtn, li.firstChild);
        }
        userList.appendChild(li);
      }
    );
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
    ws.send(JSON.stringify({ type: "check" }));

  }
  if (data.type === "users") {
    currentUsers = data.users || [];
    let mutedUsers = new Set(data.muted || []);
    adminUsers = new Set(currentUsers.filter(u => u.is_admin).map(u => u.nick));
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
      if (mutedUsers.has(user.nick)) {
        const mutedIcon = document.createElement("span");
        mutedIcon.textContent = "🔇";
        mutedIcon.title = "Muted";
        mutedIcon.style.marginRight = "4px";
        li.insertBefore(mutedIcon, li.firstChild);
      }
      console.log(adminUsers);
      if (adminUsers.has(user.nick)) {
        const adminIcon = document.createElement("span");
        adminIcon.textContent = "🛡️";
        adminIcon.title = "Admin";
        adminIcon.style.marginRight = "4px";
        li.insertBefore(adminIcon, li.firstChild);
      }

      if (is_admin && user.nick !== nick) {
        const moreBtn = document.createElement("button");
        moreBtn.textContent = "⋮";
        moreBtn.title = "More options";
        moreBtn.className = "user-action-btn more-options-btn";
        moreBtn.onclick = (e) => {
          e.stopPropagation();
          // Remove any existing menu
          document.querySelectorAll('.admin-user-menu').forEach(el => el.remove());
          // Create menu
          const menu = document.createElement("div");
          menu.className = "admin-user-menu";
          menu.style.position = "absolute";
          menu.style.left = (li.getBoundingClientRect().left - 110) + "px";
          menu.style.top = (li.getBoundingClientRect().top + window.scrollY) + "px";
          menu.innerHTML = `
            <button class="user-action-btn" data-action="mute">🔇 Mute</button>
            <button class="user-action-btn" data-action="unmute">🔊 Unmute</button>
            <button class="user-action-btn" data-action="kick">🚫 Kick</button>
            <button class="user-action-btn" data-action="ban">⛔ Ban (IP)</button>
          `;
          document.body.appendChild(menu);

          // Handle menu actions
          menu.onclick = (evt) => {
            evt.stopPropagation();
            const action = evt.target.dataset.action;
            if (action) {
              if (action === "ban") {
                ws.send(JSON.stringify({ type: "admin", action: "ban", user: user.nick }));
              } else {
                ws.send(JSON.stringify({ type: "admin", action, user: user.nick }));
              }
              menu.remove();
            }
          };

          // Close menu on outside click
          document.addEventListener("mousedown", function handler(ev) {
            if (!menu.contains(ev.target)) {
              menu.remove();
              document.removeEventListener("mousedown", handler);
            }
          });
        };
        li.style.position = "relative";
        li.insertBefore(moreBtn, li.firstChild);
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
      updateDeletedFilesInChat(); 
    });
}
codeLang.onchange = () => {
  lang = codeLang.value;
  localStorage.setItem("codeLang", lang);
};
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
      const savedName = xhr.responseText.trim();
      const url = `http://${IP}:8000/uploads/${encodeURIComponent(savedName)}`;
      
      let payload = { type: "message", nick, text: `📎 <a href="${url}" target="_blank">${savedName}</a>` };
      if (msg.dataset.replyTo) {
        payload.replyTo = msg.dataset.replyTo;
      }
      ws.send(JSON.stringify(payload));
      msg.dataset.replyTo = "";
      let replyPreview = document.getElementById('reply-preview');
      if (replyPreview) replyPreview.remove();
      // ws.send(JSON.stringify({ type: "message", nick, text: `📎 <a href="${url}" target="_blank">${savedName}</a>` }));
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

function formatMessage(data, forceDeleted = false) {
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

  let replyHtml = "";
  if (data.replyTo) {
    let repliedMsg = null;
    [...chat.children].forEach(div => {
      const original = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (original && original.timestamp === data.replyTo) repliedMsg = original;
    });
    if (repliedMsg) {
      let preview = "";
      const fileMatch = repliedMsg.text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>$/);
      if (fileMatch) {
        const url = fileMatch[1];
        const filename = fileMatch[2];
        const fileExt = filename.split('.').pop().toLowerCase();
        const isImage = ["jpg","jpeg","png","gif","webp"].includes(fileExt);
        if (isImage) {
          preview = `<img src="${url}" alt="${escapeHtml(filename)}" style="max-width:32px;max-height:32px;vertical-align:middle;margin-left:4px;border-radius:3px;border:1px solid #bbb;">`;
        } else {
          preview = `<span style="color:#888;font-size:0.85em;">[file]</span>`;
        }
      }
      const isDark = document.body.classList.contains("dark");
      const replyBg = isDark ? "#232323" : "#f7f7f7";
      const replyBorder = isDark ? "#3399ff" : "#bbb";
      const replyColor = isDark ? "#eee" : "#444";
      const replyText = escapeHtml(repliedMsg.text);
      const shortText = replyText.length > 60 ? replyText.slice(0, 60) + "..." : replyText;
      replyHtml = `<br><div class="reply-preview-in-chat" style="background:${replyBg};border-left:2px solid ${replyBorder};padding:1px 3px;margin-bottom:1px;border-radius:2px;font-size:0.72em;line-height:1.1;">
        <span style="color:${replyColor};">&#8594; replied to <b>${escapeHtml(repliedMsg.nick)}</b>: ${shortText}</span> ${preview}
      </div>`;
    }
  }

  if (fileLinkMatch) {
    const url = fileLinkMatch[1];
    const filename = fileLinkMatch[2];
    const isDeleted = forceDeleted || deletedFiles.has(filename);

    const fileExt = filename.split('.').pop().toLowerCase();
    const isImage = ["jpg","jpeg","png","gif","webp"].includes(fileExt);
    const previewEnabled = document.getElementById("toggle-image-preview")?.checked;

    if (previewEnabled && isImage) {
      return `${replyHtml}${timestamp}${nickHtml}
        <div class="file-card${isDeleted ? ' file-deleted' : ''}" 
            style="flex-direction:column; align-items:center; text-align:center; padding:10px; position:relative;">
          <img src="${url}" alt="${escapeHtml(filename)}" 
              style="max-width:220px; max-height:220px; border-radius:6px; margin-bottom:10px; cursor:pointer;" 
              onclick="downloadFileWithProgress('${url}', '${escapeHtml(filename)}')">
          <button class="zoom-btn" onclick="openImageModal('${url}', '${escapeHtml(filename)}')">🔍</button>
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-top:6px;">
            <span class="file-name" style="flex-grow:1; text-align:left; ${isDeleted ? 'text-decoration:line-through;color:#888;' : ''}">
              ${escapeHtml(filename)}${isDeleted ? ' (deleted)' : ''}
            </span>
            ${!isDeleted ? `<button class="file-download-btn" 
                              onclick="downloadFileWithProgress('${url}', '${escapeHtml(filename)}')" 
                              style="margin-left:10px;">Download</button>` : ''}
          </div>
          <div class="download-progress" id="download-progress-${escapeHtml(filename)}" 
              style="display:none;margin-top:4px;font-size:0.95em;color:#28a745; text-align:left;"></div>
        </div>`;
    } else {
      return `${replyHtml}${timestamp}${nickHtml}
        <div class="file-card${isDeleted ? ' file-deleted' : ''}">
          <span class="file-icon">📄</span>
          <span class="file-name" style="${isDeleted ? 'text-decoration:line-through;color:#888;' : ''}">${escapeHtml(filename)}${isDeleted ? ' (deleted)' : ''}</span>
          ${!isDeleted ? `<button class="file-download-btn" onclick="downloadFileWithProgress('${url}', '${escapeHtml(filename)}')">Download</button>` : ''}
          <div class="download-progress" id="download-progress-${escapeHtml(filename)}" style="display:none;margin-top:4px;font-size:0.95em;color:#28a745;"></div>
        </div>`;
    }
  }

  const singleCodeMatch = text.trim().match(/^```(\w+)?\n?([\s\S]*?)```$/);
  if (singleCodeMatch) {
    let lang = singleCodeMatch[1] ? singleCodeMatch[1].toLowerCase() : "plaintext";
    const code = singleCodeMatch[2];
    return `${replyHtml}${timestamp}${nickHtml}
      <div class="code-block">
        <pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>
        <button class="copy-btn" title="Copy code">Copy</button>
      </div>`;
  }

  let processed = text;
  const codeBlocks = [];
  processed = processed.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    lang = lang ? lang.toLowerCase() : "plaintext";
    codeBlocks.push({ lang, code });
    return `___CODEBLOCK${codeBlocks.length - 1}___`;
  });

  processed = escapeHtml(processed);
  processed = processed.replace(/___CODEBLOCK(\d+)___/g, (_, i) => {
    const { lang, code } = codeBlocks[i];
    return `
      <div class="code-block">
        <pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>
        <button class="copy-btn" title="Copy code">Copy</button>
      </div>
    `;
  });

  let replyBtn = "";
  if (showReplyBtn) {
    replyBtn = `<button class="reply-btn" data-timestamp="${data.timestamp}" style="margin-left:4px;font-size:0.75em;padding:1px 4px;background:#eee;border:1px solid #ccc;color:#444;border-radius:4px;cursor:pointer;line-height:1;">↩</button>`;
  }
  return `${replyHtml}${timestamp}${nickHtml} ${processed} ${replyBtn}`;
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
  if (e.target.classList.contains('reply-btn')) {
    const ts = e.target.dataset.timestamp;
    const div = e.target.closest('div');
    const originalData = div?.dataset.original ? JSON.parse(div.dataset.original) : null;
    if (originalData) {
      let replyPreview = document.getElementById('reply-preview');
      if (!replyPreview) {
        replyPreview = document.createElement('div');
        replyPreview.id = 'reply-preview';
        if (darkModeToggle.checked) {
          replyPreview.style.background = '#333';
          replyPreview.style.color = '#eee';
          replyPreview.style.border = '1px solid #555';
        } else {
          replyPreview.style.background = '#f0f0f0';
          replyPreview.style.color = '#000';
          replyPreview.style.border = '1px solid #ccc';
        }
        replyPreview.style.borderRadius = '6px';
        replyPreview.style.padding = '6px 10px';
        replyPreview.style.marginBottom = '6px';
        replyPreview.style.fontSize = '0.95em';
        replyPreview.style.maxWidth = '90%';
        const replyPreviewContainer = document.getElementById('reply-preview-container');
        if (replyPreviewContainer) {
          replyPreviewContainer.innerHTML = '';
          replyPreviewContainer.appendChild(replyPreview);
        }
      }
      let previewContent = "";
      const fileMatch = originalData.text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>$/);
      if (fileMatch) {
        const url = fileMatch[1];
        const filename = fileMatch[2];
        const fileExt = filename.split('.').pop().toLowerCase();
        const isImage = ["jpg","jpeg","png","gif","webp"].includes(fileExt);
        if (isImage) {
          previewContent = `<img src="${url}" alt="${escapeHtml(filename)}" style="max-width:48px;max-height:48px;vertical-align:middle;margin-left:8px;border-radius:4px;border:1px solid #bbb;">`;
        } else {
          previewContent = `<span style="color:#888;font-size:0.95em;">[file]</span>`;
        }
      }

      const replyText = escapeHtml(originalData.text);
      const shortText = replyText.length > 80 ? replyText.slice(0, 80) + "..." : replyText;

      replyPreview.innerHTML = `<b>Replying to:</b> <span style="color:#007bff">${escapeHtml(originalData.nick)}</span>: ${shortText} ${previewContent} <button id="cancel-reply" style="float:right;font-size:0.8em;padding:1px 6px;line-height:1.1;border-radius:4px;background:#eee;border:1px solid #ccc;color:#444;cursor:pointer;">✖</button>`;
      msg.focus();
      msg.dataset.replyTo = ts;
    }
  }
  if (e.target.id === 'cancel-reply') {
    let replyPreview = document.getElementById('reply-preview');
    if (replyPreview) replyPreview.remove();
    msg.dataset.replyTo = "";
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
      progressDiv.textContent = "";
      showError("Download failed! Arcabit blocked downloading. If Arcabit ssie pałe to wejdź w pliki i pobierz Browser");
      progressDiv.textContent = "Download failed!";
      setTimeout(() => progressDiv.style.display = "none", 2000);
    });
};

let i = setInterval(() => {
  if (!isAlive) {
    const div = document.createElement("div");
    div.innerHTML = `<span style="color: red;"><b>⚠️ Połączenie z serwerem zostało utracone.</b></span>`;
    chat.appendChild(div);
    if (isChatAtBottom()) {
      chat.scrollTop = chat.scrollHeight;
    }
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
    if (isChatAtBottom()) {
      chat.scrollTop = chat.scrollHeight;
    }
  }
}, 5000);

const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const closeSettingsBtn = document.getElementById("close-settings-btn");

settingsBtn.onclick = () => {
  settingsModal.style.display = "flex";
};

closeSettingsBtn.onclick = () => {
  settingsModal.style.display = "none";
};

// Optional: close modal when clicking outside content
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    settingsModal.style.display = "none";
  }
});

function updateDeletedFilesInChat() {
  fetch("/file-list")
    .then(res => res.json())
    .then(serverFiles => {
      const serverFilesSet = new Set(serverFiles);
      [...chat.children].forEach(div => {
        const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
        if (
          originalData &&
          originalData.text &&
          /^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>$/.test(originalData.text)
        ) {
          const match = originalData.text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>$/);
          if (match) {
            const filename = match[2];
            if (!serverFilesSet.has(filename)) {
              deletedFiles.add(filename);
              div.classList.add("file-deleted");
              div.innerHTML = formatMessage(originalData, true);
            } else {
              deletedFiles.delete(filename);
              div.classList.remove("file-deleted");
              div.innerHTML = formatMessage(originalData, false);
            }
          }
        }
      });
    });
}
const langEmojis = {
  plaintext: "📋",
  php: "🐘",
  python: "🐍",
  javascript: "✨",
  html: "🌐",
  css: "🎨",
  sql: "🗄️"
};

function setLangSelectDisplay() {
  for (const opt of codeLang.options) {
    const val = opt.value;
    if (codeLang.value === val) {
      opt.textContent = val === "plaintext" ? `${langEmojis[val]} None` : (langEmojis[val] || "");
    } else {
      if (langEmojis[val]) {
        if (val === "plaintext") {
          opt.textContent = `${langEmojis[val]} None`;
          continue;
        }
        opt.textContent = `${langEmojis[val]} ${val.charAt(0).toUpperCase() + val.slice(1)}`;
      }
    }
  }
}

codeLang.addEventListener("mousedown", () => {
  for (const opt of codeLang.options) {
    const val = opt.value;
    if (langEmojis[val]) {
      if (val === "plaintext") {
        opt.textContent = `${langEmojis[val]} None`;
      } else {
        opt.textContent = `${langEmojis[val]} ${val.charAt(0).toUpperCase() + val.slice(1)}`;
      }
    }
  }
});
codeLang.addEventListener("change", setLangSelectDisplay);
codeLang.addEventListener("blur", setLangSelectDisplay);

setLangSelectDisplay();

function adjustMainChatWidth() {
  const isMobile = window.innerWidth <= 900;
  const fileListHidden = fileListDiv.classList.contains("hide") || fileListDiv.style.display === "none";
  if (isMobile && fileListHidden) {
    mainChat.style.maxWidth = "100%";
    mainChat.style.width = "100%";
  } else if (isMobile) {
    mainChat.style.maxWidth = "";
    mainChat.style.width = "";
  }
}

const toggleImagePreview = document.getElementById("toggle-image-preview");
if (toggleImagePreview) {
  toggleImagePreview.addEventListener("change", () => {
    [...chat.children].forEach(div => {
      const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (originalData) {
        div.innerHTML = formatMessage(originalData);
      }
    });
  });
}

window.openImageModal = function(url, filename) {
  const modal = document.getElementById("image-modal");
  const modalImg = document.getElementById("modal-img");
  modal.style.display = "flex";
  modalImg.src = url;
  modalImg.alt = filename;
};

window.closeImageModal = function() {
  document.getElementById("image-modal").style.display = "none";
};


let imageList = [];
let currentIndex = 0;
let zoomLevel = 1;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let imgOffsetX = 0, imgOffsetY = 0;

window.openImageModal = function(url, filename) {
  const modal = document.getElementById("image-modal");
  const modalImg = document.getElementById("modal-img");

  // collect all image URLs currently in chat, skipping deleted files
  const images = [...document.querySelectorAll(".file-card img")].filter(img => {
    const fname = img.alt || img.dataset.filename || "";
    return !deletedFiles.has(fname);
  });

  imageList = images.map(img => img.src);
  currentIndex = imageList.indexOf(url);

  if (currentIndex === -1) return;

  modal.style.display = "flex";
  modalImg.src = url;
  modalImg.alt = filename;

  zoomLevel = 1;
  imgOffsetX = imgOffsetY = 0;
  modalImg.style.transform = `translate(0px, 0px) scale(1)`;
};

window.closeImageModal = function() {
  const modal = document.getElementById("image-modal");
  modal.style.display = "none";
};

// Close by clicking background
document.getElementById("image-modal").addEventListener("click", (e) => {
  if (e.target.id === "image-modal") {
    closeImageModal();
  }
});

window.navigateImage = function(direction) {
  if (!imageList.length) return;
  currentIndex = (currentIndex + direction + imageList.length) % imageList.length;
  const modalImg = document.getElementById("modal-img");
  modalImg.src = imageList[currentIndex];
  zoomLevel = 1;
  imgOffsetX = imgOffsetY = 0;
  modalImg.style.transform = `translate(0px, 0px) scale(1)`;
};

// Zoom with wheel
document.getElementById("modal-img").addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomLevel += e.deltaY < 0 ? 0.2 : -0.2;
  if (zoomLevel < 1) zoomLevel = 1;
  if (zoomLevel > 5) zoomLevel = 5;
  e.target.style.transform = `translate(${imgOffsetX}px, ${imgOffsetY}px) scale(${zoomLevel})`;
});

// Reset zoom on double click
document.getElementById("modal-img").addEventListener("dblclick", (e) => {
  zoomLevel = 1;
  imgOffsetX = imgOffsetY = 0;
  e.target.style.transform = `translate(0px, 0px) scale(1)`;
});

// --- Drag to pan when zoomed ---
const modalImg = document.getElementById("modal-img");

modalImg.addEventListener("mousedown", (e) => {
  if (zoomLevel <= 1) return; // no drag if not zoomed
  isDragging = true;
  dragStartX = e.clientX - imgOffsetX;
  dragStartY = e.clientY - imgOffsetY;
  modalImg.style.cursor = "grabbing";
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  imgOffsetX = e.clientX - dragStartX;
  imgOffsetY = e.clientY - dragStartY;
  modalImg.style.transform = `translate(${imgOffsetX}px, ${imgOffsetY}px) scale(${zoomLevel})`;
});

window.addEventListener("mouseup", () => {
  isDragging = false;
  modalImg.style.cursor = zoomLevel > 1 ? "grab" : "default";
});


toggleFileLinks.addEventListener("change", adjustMainChatWidth);
window.addEventListener("resize", adjustMainChatWidth);

adjustMainChatWidth();
window.onload = adjustMainChatWidth;