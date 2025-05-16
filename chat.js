let currentUsers = [];
let nick = "";
const ws = new WebSocket(`ws://${location.hostname}:6789`);
let IP = ""
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

let showTimestamps = true;
let showFileLinks = true;

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

code.onclick = () => {
  const selected = msg.value.slice(msg.selectionStart, msg.selectionEnd);
  const wrapped = "```\n" + (selected || msg.value) + "\n```";
  ws.send(JSON.stringify({ type: "message", nick, text: wrapped }));
  msg.value = "";
};

function sendMessage() {
  const text = msg.value;
  if (!text.trim()) return;
  ws.send(JSON.stringify({ type: "message", nick, text }));
  msg.value = "";
}

ws.onopen = () => {
  nick = promptForNick();
  ws.send(JSON.stringify({ type: "join", nick }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "nick-update") {
    nick = data.nick;
  }

  if (data.type === "message") {
    const div = document.createElement("div");
    div.dataset.timestamp = data.timestamp;
    div.dataset.original = JSON.stringify(data);
    div.innerHTML = formatMessage(data);
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }
  
  if (data.type === "IP") {
    const ip = document.getElementById("LAN");
    if (ip) ip.innerHTML = `LAN chat - ${data.ip}:8000`;
    IP = data.ip
  }

  if (data.type === "users") {
    currentUsers = data.users || [];
    userList.innerHTML = "";
    currentUsers.forEach(user => {
      const li = document.createElement("li");
      li.textContent = user;
      if (user === nick) li.style.color = "lime";
      userList.appendChild(li);
    });
  }
};

toggleFileLinks.checked = showFileLinks;
toggleFileLinks.addEventListener("change", () => {
  showFileLinks = toggleFileLinks.checked;
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

  // If entire message is a single code block
  if (/^```([\s\S]*?)```$/.test(text.trim())) {
    const code = text.trim().replace(/^```([\s\S]*?)```$/, "$1");
    return `${timestamp}<b>${escapeHtml(data.nick)}:</b>
      <div class="code-block" style="position: relative; padding-bottom: 2em; margin: 8px 0;">
        <pre class="code-raw">${escapeHtml(code)}</pre>
        <button class="copy-btn" title="Copy code" style="position: absolute; bottom: 5px; right: 5px; font-size: 0.75em; padding: 3px 6px;">Copy</button>
      </div>`;
  }

  // Parse multiple code blocks and links
  let processed = text;

  // Extract code blocks
  const codeBlocks = [];
  processed = processed.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `___CODEBLOCK${codeBlocks.length - 1}___`;
  });

  // Extract links if enabled
  const links = [];
  if (showFileLinks) {
    processed = processed.replace(/<a\s+[^>]+>(.*?)<\/a>/gi, (match) => {
      links.push(match);
      return `___LINK${links.length - 1}___`;
    });
  }

  // Escape remaining text
  processed = escapeHtml(processed);

  // Restore links
  processed = processed.replace(/___LINK(\d+)___/g, (_, i) => links[i]);

  // Restore code blocks with copy button bottom right
  processed = processed.replace(/___CODEBLOCK(\d+)___/g, (_, i) => {
    const escapedCode = escapeHtml(codeBlocks[i]);
    return `
      <div class="code-block" style="position: relative; padding-bottom: 2em; margin: 8px 0;">
        <pre><code>${escapedCode}</code></pre>
        <button class="copy-btn" title="Copy code" style="position: absolute; bottom: 5px; right: 5px; font-size: 0.75em; padding: 3px 6px;">Copy</button>
      </div>
    `;
  });

  return `${timestamp}<b>${escapeHtml(data.nick)}:</b> ${processed}`;
}

// Single event listener for copy buttons
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
    // Make textarea out of viewport
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







// Your escapeHtml function:
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}





document.addEventListener('click', e => {
  if (e.target.classList.contains('copy-btn')) {
    const code = e.target.closest(".code-block")?.querySelector("code");
    if (code && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code.textContent).then(() => {
        e.target.textContent = "Copied!";
        setTimeout(() => e.target.textContent = "Copy", 1500);
      }).catch(() => {
        e.target.textContent = "Failed";
        setTimeout(() => e.target.textContent = "Copy", 1500);
      });
    }
  }
});

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return "[Invalid time]";
  }
}

settingsBtn.onclick = () => {
  settingsPanel.style.display = settingsPanel.style.display === "none" ? "block" : "none";
};

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

function uploadFile() {
  const input = document.getElementById("fileInput");
  const file = input?.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  fetch("/upload", {
    method: "POST",
    body: formData
  }).then(res => {
    if (res.ok) {
      console.log(IP)
      const url = `http://${IP}:8000/uploads/${encodeURIComponent(file.name)}`;
      ws.send(JSON.stringify({ type: "message", nick, text: `📎 <a href="${url}" target="_blank">${file.name}</a>` }));
    } else {
      alert("Failed to upload file");
    }
  });
}
