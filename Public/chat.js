let currentUsers = [];
let userColors = {};
let adminUsers = new Set();
let nick = "";
let IP = "";
let is_admin = false;

const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${wsProtocol}://${location.hostname}:6789`);
console.log("v: 1.7.0");
let chatCryptoKey = null;
let accountPassword = null;
let pendingAccountPassword = null;
let encryptionFeaturesEnabled = localStorage.getItem("encryptionFeaturesEnabled") !== "false";
let encryptionEnabled = localStorage.getItem("e2eEncryptionEnabled") === "true";
let encryptionMode = localStorage.getItem("e2eEncryptionMode") || "AES-GCM-256";
let encryptionColorsEnabled = localStorage.getItem("encryptionColorsEnabled") !== "false";
let hideUnreadableEncrypted = localStorage.getItem("hideUnreadableEncrypted") === "true";
const chatEncryptionKeyInput = document.getElementById("chat-encryption-key");
const setChatEncryptionKeyButton = document.getElementById("set-chat-encryption-key");
const encryptionStatus = document.getElementById("encryption-status");
const toggleEncryptionFeatures = document.getElementById("toggle-encryption-features");
const encryptionDependentSettings = document.getElementById("encryption-dependent-settings");
const toggleE2EEncryption = document.getElementById("toggle-e2e-encryption");
const encryptionModeSelect = document.getElementById("encryption-mode");
const recheckEncryptionKeyButton = document.getElementById("recheck-encryption-key");
const toggleEncryptionColors = document.getElementById("toggle-encryption-colors");
const toggleHideUnreadableEncrypted = document.getElementById("toggle-hide-unreadable-encrypted");
const toggleChatKeyVisibilityButton = document.getElementById("toggle-chat-key-visibility");
const encryptionHelpPopup = document.getElementById("encryption-help-popup");
const openEncryptionSettingsButton = document.getElementById("open-encryption-settings");
const closeEncryptionHelpButton = document.getElementById("close-encryption-help");
const dismissEncryptionHelpButton = document.getElementById("dismiss-encryption-help");
let encryptionRecheckPending = false;

function setEncryptionStatus(message, isError = false) {
  if (encryptionStatus) {
    encryptionStatus.textContent = message;
    encryptionStatus.style.color = isError ? "#dc3545" : "#198754";
  }
}

function showEncryptionHelpPopup() {
  if (encryptionHelpPopup) encryptionHelpPopup.hidden = false;
}

function closeEncryptionHelpPopup() {
  if (encryptionHelpPopup) encryptionHelpPopup.hidden = true;
}

function setEncryptionStatusForCurrentState() {
  if (!encryptionFeaturesEnabled) {
    setEncryptionStatus("Encryption features are off. Messages are sent and shown without encryption.");
  } else if (!window.crypto?.subtle && !window.CryptoJS) {
    setEncryptionStatus("Encryption unavailable: this browser has no supported crypto API.", true);
  } else if (encryptionEnabled && !chatCryptoKey) {
    setEncryptionStatus("Action required: enable a shared key in this section before sending encrypted messages.", true);
  } else if (encryptionEnabled) {
    setEncryptionStatus("Ready: new messages use " + encryptionMode + ".");
  } else {
    setEncryptionStatus("Ready: encryption is off for new messages; existing encrypted messages can still be read with the right key.");
  }
}

function updateEncryptionSettingsLock() {
  if (!encryptionDependentSettings) return;
  encryptionDependentSettings.classList.toggle("encryption-settings-disabled", !encryptionFeaturesEnabled);
  encryptionDependentSettings.querySelectorAll("input, select, button").forEach(control => {
    control.disabled = !encryptionFeaturesEnabled;
  });
}

function removeEncryptedMessagesFromView() {
  chat?.querySelectorAll("[data-original]").forEach(messageElement => {
    const message = JSON.parse(messageElement.dataset.original);
    if (message.encrypted) messageElement.remove();
  });
}

function encryptKeyForProfile(passphrase) {
  if (!accountPassword || !window.CryptoJS) return null;
  return CryptoJS.AES.encrypt(passphrase, accountPassword).toString();
}

function decryptKeyFromProfile(encryptedPassphrase) {
  if (!accountPassword || !window.CryptoJS || !encryptedPassphrase) return null;
  try {
    const passphrase = CryptoJS.AES.decrypt(encryptedPassphrase, accountPassword)
      .toString(CryptoJS.enc.Utf8);
    return passphrase || null;
  } catch {
    return null;
  }
}

function saveChatKeyToProfile(passphrase) {
  const encryptedPassphrase = encryptKeyForProfile(passphrase);
  if (loggedInUser && encryptedPassphrase && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "save-settings",
      username: loggedInUser,
      settings: { encryptedChatKey: encryptedPassphrase }
    }));
    return true;
  }
  return false;
}

async function deriveChatKey(passphrase) {
  if (!window.crypto?.subtle && !window.CryptoJS) {
    throw new Error("No browser encryption support is available.");
  }
  if (!window.crypto?.subtle || encryptionMode === "AES-CBC-HMAC-256") {
    const keyLength = encryptionMode === "AES-GCM-128" ? 128 : 256;
    const derived = CryptoJS.PBKDF2(passphrase, "lan-chat-e2e-room-v1", {
      keySize: (keyLength + 256) / 32,
      iterations: 250000,
      hasher: CryptoJS.algo.SHA256
    });
    const aesWordCount = keyLength / 32;
    const aesWords = derived.words.slice(0, aesWordCount);
    const macWords = derived.words.slice(aesWordCount, aesWordCount + 8);
    return {
      backend: "fallback",
      aesKey: CryptoJS.lib.WordArray.create(aesWords, keyLength / 8),
      macKey: CryptoJS.lib.WordArray.create(macWords, 32)
    };
  }
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  const keyLength = encryptionMode === "AES-GCM-128" ? 128 : 256;
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("lan-chat-e2e-room-v1"),
      iterations: 250000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: keyLength },
    false,
    ["encrypt", "decrypt"]
  );
  return { backend: "native", key };
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function setChatEncryptionKey(passphrase, options = {}) {
  if (!encryptionFeaturesEnabled) {
    setEncryptionStatus("Enable encryption features before loading a key.", true);
    return false;
  }
  if (!passphrase || passphrase.length < 5) {
    setEncryptionStatus("Use at least 5 characters.", true);
    return false;
  }
  try {
    const shouldShowLoading = encryptionFeaturesEnabled && !options.silent;
    if (shouldShowLoading) showChatLoading("Setting up end to end encryption...");
    const loadingStartedAt = performance.now();
    const originalButtonText = setChatEncryptionKeyButton?.textContent;
    if (setChatEncryptionKeyButton && !options.automatic) {
      setChatEncryptionKeyButton.textContent = "Loading...";
      setChatEncryptionKeyButton.disabled = true;
    }
    setEncryptionStatus("Loading...");
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 120)));
    chatCryptoKey = await deriveChatKey(passphrase);
    const remainingLoadingTime = Math.max(0, 2500 - (performance.now() - loadingStartedAt));
    if (remainingLoadingTime) {
      await new Promise(resolve => setTimeout(resolve, remainingLoadingTime));
    }
    sessionStorage.setItem("lanChatE2EKey", passphrase);
    if (chatEncryptionKeyInput) chatEncryptionKeyInput.value = passphrase;
    const profileSaved = saveChatKeyToProfile(passphrase);
    setEncryptionStatus(profileSaved
      ? "Loaded: encrypted copy saved to your profile."
      : "Loaded: key is ready.");
    const shouldRefreshHistory = options.requestHistory && (autoRecover || options.forceHistory);
    if (ws.readyState === WebSocket.OPEN && shouldRefreshHistory) {
      ws.send(JSON.stringify({ type: "get-history" }));
    }
    if (shouldShowLoading && !options.keepLoading && !shouldRefreshHistory) hideChatLoading();
    if (setChatEncryptionKeyButton && !options.automatic) {
      setChatEncryptionKeyButton.textContent = originalButtonText || "Set";
      setChatEncryptionKeyButton.disabled = false;
    }
    return true;
  } catch (error) {
    if (setChatEncryptionKeyButton && !options.automatic) {
      setChatEncryptionKeyButton.textContent = "Set";
      setChatEncryptionKeyButton.disabled = false;
    }
    setEncryptionStatus(error.message, true);
    if (shouldShowLoading) hideChatLoading();
    return false;
  }
}

async function encryptChatMessage(text) {
  if (!encryptionFeaturesEnabled || !encryptionEnabled) return { text };
  if (!chatCryptoKey) {
    setEncryptionStatus("Action required: set a shared key in Settings before sending encrypted messages.", true);
    showEncryptionHelpPopup();
    return null;
  }
  if (chatCryptoKey.backend === "fallback") {
    const iv = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt(text, chatCryptoKey.aesKey, { iv });
    const ivBase64 = CryptoJS.enc.Base64.stringify(iv);
    const ciphertext = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
    const mac = CryptoJS.HmacSHA256(ivBase64 + "." + ciphertext, chatCryptoKey.macKey)
      .toString(CryptoJS.enc.Base64);
    return { ciphertext, iv: ivBase64, mac, encryptionBackend: "fallback" };
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chatCryptoKey.key, encoded);
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv), encryptionBackend: "native" };
}

async function decryptChatMessage(data) {
  if (!data.encrypted) return { ...data, encryptionState: "plain" };
  if (!encryptionFeaturesEnabled) {
    return {
      ...data,
      text: "[Encrypted message: encryption features are disabled]",
      encryptionState: "locked"
    };
  }
  if (!chatCryptoKey) return { ...data, text: "[Encrypted message: set the shared chat passphrase]", encryptionState: "locked" };
  try {
    if (data.encryptionBackend === "fallback") {
      if (chatCryptoKey.backend !== "fallback" || !data.mac) throw new Error("Missing authentication tag");
      const expectedMac = CryptoJS.HmacSHA256(data.iv + "." + data.ciphertext, chatCryptoKey.macKey)
        .toString(CryptoJS.enc.Base64);
      if (expectedMac !== data.mac) throw new Error("Invalid message authentication");
      const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: CryptoJS.enc.Base64.parse(data.ciphertext) },
        chatCryptoKey.aesKey,
        { iv: CryptoJS.enc.Base64.parse(data.iv) }
      ).toString(CryptoJS.enc.Utf8);
      if (!decrypted) throw new Error("Invalid plaintext");
      return { ...data, text: decrypted, encryptionState: "decrypted" };
    }
    if (chatCryptoKey.backend !== "native") throw new Error("Wrong encryption backend");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(data.iv) },
      chatCryptoKey.key,
      base64ToBytes(data.ciphertext)
    );
    return { ...data, text: new TextDecoder().decode(plaintext), encryptionState: "decrypted" };
  } catch {
    return { ...data, text: "[Unable to decrypt message with this key]", encryptionState: "wrong-key" };
  }
}

async function waitForEncryptionSetup() {
  if (!encryptionFeaturesEnabled || chatCryptoKey) return;
  for (let attempt = 0; attempt < 120 && !chatCryptoKey; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

if (toggleEncryptionFeatures) toggleEncryptionFeatures.checked = encryptionFeaturesEnabled;
updateEncryptionSettingsLock();
if (toggleE2EEncryption) toggleE2EEncryption.checked = encryptionEnabled;
if (encryptionModeSelect) encryptionModeSelect.value = encryptionMode;
if (toggleEncryptionColors) toggleEncryptionColors.checked = encryptionColorsEnabled;
if (toggleHideUnreadableEncrypted) toggleHideUnreadableEncrypted.checked = hideUnreadableEncrypted;
toggleEncryptionFeatures?.addEventListener("change", () => {
  encryptionFeaturesEnabled = toggleEncryptionFeatures.checked;
  localStorage.setItem("encryptionFeaturesEnabled", encryptionFeaturesEnabled);
  updateEncryptionSettingsLock();
  if (!encryptionFeaturesEnabled) {
    chatCryptoKey = null;
    if (chatEncryptionKeyInput) chatEncryptionKeyInput.value = "";
    hideChatLoading();
    safeSend({ type: "get-history" });
  } else {
    const savedChatKey = sessionStorage.getItem("lanChatE2EKey");
    if (savedChatKey) {
      chatEncryptionKeyInput.value = savedChatKey;
      encryptionRecheckPending = true;
      setChatEncryptionKey(savedChatKey, { automatic: true, requestHistory: true, forceHistory: true })
        .then(accepted => {
          if (!accepted) encryptionRecheckPending = false;
        });
    } else {
      setEncryptionStatusForCurrentState();
    }
  }
  setEncryptionStatusForCurrentState();
});
toggleE2EEncryption?.addEventListener("change", () => {
  encryptionEnabled = toggleE2EEncryption.checked;
  localStorage.setItem("e2eEncryptionEnabled", encryptionEnabled);
  setEncryptionStatusForCurrentState();
});
encryptionModeSelect?.addEventListener("change", () => {
  encryptionMode = encryptionModeSelect.value;
  localStorage.setItem("e2eEncryptionMode", encryptionMode);
  chatCryptoKey = null;
  const savedChatKey = sessionStorage.getItem("lanChatE2EKey");
  if (encryptionFeaturesEnabled && savedChatKey) {
    setChatEncryptionKey(savedChatKey, { requestHistory: true });
  }
  else setEncryptionStatusForCurrentState();
});
toggleEncryptionColors?.addEventListener("change", () => {
  encryptionColorsEnabled = toggleEncryptionColors.checked;
  localStorage.setItem("encryptionColorsEnabled", encryptionColorsEnabled);
  refreshEncryptionColors();
});
toggleHideUnreadableEncrypted?.addEventListener("change", () => {
  hideUnreadableEncrypted = toggleHideUnreadableEncrypted.checked;
  localStorage.setItem("hideUnreadableEncrypted", hideUnreadableEncrypted);
  if (ws.readyState === WebSocket.OPEN) safeSend({ type: "get-history" });
});

if (!window.crypto?.subtle && !window.CryptoJS) {
  setEncryptionStatusForCurrentState();
} else {
  const savedChatKey = sessionStorage.getItem("lanChatE2EKey");
  if (encryptionFeaturesEnabled && savedChatKey) {
    if (chatEncryptionKeyInput) chatEncryptionKeyInput.value = savedChatKey;
    setEncryptionStatus("Key saved. Click Set to load it.");
  } else {
    setEncryptionStatusForCurrentState();
  }
}
if (setChatEncryptionKeyButton) {
  setChatEncryptionKeyButton.addEventListener("click", async () => {
    encryptionRecheckPending = true;
    const accepted = await setChatEncryptionKey(chatEncryptionKeyInput?.value || "", {
      requestHistory: true,
      forceHistory: true
    });
    if (!accepted) encryptionRecheckPending = false;
  });
}
toggleChatKeyVisibilityButton?.addEventListener("click", () => {
  const isHidden = chatEncryptionKeyInput.type === "password";
  chatEncryptionKeyInput.type = isHidden ? "text" : "password";
  toggleChatKeyVisibilityButton.setAttribute("aria-label", isHidden ? "Hide shared key" : "Show shared key");
  toggleChatKeyVisibilityButton.title = isHidden ? "Hide shared key" : "Show shared key";
});
recheckEncryptionKeyButton?.addEventListener("click", async () => {
  const passphrase = chatEncryptionKeyInput?.value || sessionStorage.getItem("lanChatE2EKey") || "";
  encryptionRecheckPending = true;
  if (chatEncryptionKeyInput?.value) {
    const accepted = await setChatEncryptionKey(passphrase, { requestHistory: true, forceHistory: true });
    if (!accepted) {
      encryptionRecheckPending = false;
      return;
    }
  } else if (!chatCryptoKey) {
    encryptionRecheckPending = false;
    setEncryptionStatus("Enter the shared key first.", true);
    return;
  }
  if (ws.readyState === WebSocket.OPEN && !chatEncryptionKeyInput?.value) {
    ws.send(JSON.stringify({ type: "get-history" }));
    setEncryptionStatus("Checking stored messages with the current key...");
  }
});

closeEncryptionHelpButton?.addEventListener("click", closeEncryptionHelpPopup);
dismissEncryptionHelpButton?.addEventListener("click", closeEncryptionHelpPopup);
openEncryptionSettingsButton?.addEventListener("click", () => {
  closeEncryptionHelpPopup();
  document.getElementById("settings-modal").style.display = "flex";
});
encryptionHelpPopup?.addEventListener("click", event => {
  if (event.target === encryptionHelpPopup) closeEncryptionHelpPopup();
});
let lang = "javascript";
const favKey = "giphy_favorites";
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
const clearFilesBtn = document.getElementById("clear-files-btn");
const customNickColorInput = document.getElementById("custom-nick-color");
const attachBtn = document.getElementById("attach-btn");
const attachPopup = document.getElementById("attach-popup");
const attachFileBtn = document.getElementById("attach-file-btn");
const attachPreview = document.getElementById("attach-preview");
const toggleAutoRecover = document.getElementById("toggle-auto-recover");
const toggleGifFeature = document.getElementById("toggle-gif-feature");
const recoverBtn = document.getElementById("recover-chat-btn");
const closeRecoverBtn = document.getElementById("close-recover-btn");
let loggedInUser = localStorage.getItem("loggedInUser");
let authMode = "login";
const entryScreen = document.getElementById("entry-screen");
const entryNicknameForm = document.getElementById("entry-nickname-form");
const entryNicknameInput = document.getElementById("entry-nickname");
const entryLoginButton = document.getElementById("entry-login-button");
const entryRegisterButton = document.getElementById("entry-register-button");
const chatLoadingScreen = document.getElementById("chat-loading-screen");
const chatLoadingMessage = document.getElementById("chat-loading-message");
let userFavorites = [];
let attachedFile = null;
let attachPreviewUrl = null;
let uploadInProgress = false;
let deletedFiles = new Set();

function showChatLoading(message) {
  if (!chatLoadingScreen) return;
  if (chatLoadingMessage) chatLoadingMessage.textContent = message;
  chatLoadingScreen.hidden = false;
}

function hideChatLoading() {
  if (chatLoadingScreen) chatLoadingScreen.hidden = true;
}
if (localStorage.getItem("showTimestamps") === null) {
  localStorage.setItem("showTimestamps", "true");
}
if (toggleAutoRecover) {
  toggleAutoRecover.addEventListener("change", () => {
    autoRecover = toggleAutoRecover.checked;
    localStorage.setItem("autoRecover", autoRecover);
  });
}
let autoRecover = localStorage.getItem("autoRecover") === "true";
if (toggleAutoRecover) toggleAutoRecover.checked = autoRecover;
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
    refreshEncryptionColors();
  });
}

function showError(msg) {
  const box = document.getElementById("error-message");
  if (!box) return;
  box.innerHTML = msg;
  box.style.display = "block";
  setTimeout(() => {
    box.style.display = "none";
  }, 4000);
}

function showEntryScreen() {
  if (!entryScreen) return;
  entryScreen.classList.remove("entry-screen-hidden");
  entryNicknameInput.value = localStorage.getItem("lastNick") || "";
  requestAnimationFrame(() => entryNicknameInput.focus());
}

function hideEntryScreen() {
  if (entryScreen) entryScreen.classList.add("entry-screen-hidden");
}

function resetEncryptionForGuest() {
  encryptionFeaturesEnabled = false;
  encryptionEnabled = false;
  chatCryptoKey = null;
  accountPassword = null;
  pendingAccountPassword = null;
  sessionStorage.removeItem("lanChatE2EKey");
  localStorage.setItem("encryptionFeaturesEnabled", "false");
  localStorage.setItem("e2eEncryptionEnabled", "false");
  if (chatEncryptionKeyInput) chatEncryptionKeyInput.value = "";
  if (toggleEncryptionFeatures) toggleEncryptionFeatures.checked = false;
  if (toggleE2EEncryption) toggleE2EEncryption.checked = false;
  updateEncryptionSettingsLock();
  hideChatLoading();
  setEncryptionStatusForCurrentState();
}

function joinAsGuest(nickname) {
  const cleanNickname = nickname.trim();
  if (!cleanNickname || cleanNickname.length > 16) {
    entryNicknameInput.focus();
    return;
  }
  resetEncryptionForGuest();
  localStorage.setItem("lastNick", cleanNickname);
  nick = cleanNickname;
  hideEntryScreen();
  safeSend({ type: "join", nick: cleanNickname });
}

function setAuthMode(mode) {
  authMode = mode;
  const title = document.getElementById("auth-title");
  const subtitle = document.querySelector(".auth-subtitle");
  const loginButton = document.getElementById("login-btn");
  const registerButton = document.getElementById("register-btn");
  if (!title || !subtitle || !loginButton || !registerButton) return;
  const isLogin = mode === "login";
  title.textContent = isLogin ? "Log in" : "Register";
  subtitle.textContent = isLogin ? "Use your account to continue." : "Create an account to continue.";
  loginButton.innerHTML = isLogin ? "Log in <span aria-hidden='true'>&#8594;</span>" : "Create account <span aria-hidden='true'>&#8594;</span>";
  registerButton.textContent = isLogin ? "Create account" : "Back to login";
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
  const inputArea = document.querySelector('.input-area');
  const msgInput = document.getElementById("msg");
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
  sendFileBtn.style.display = togglePostFiles.checked ? "" : "none";
  attachFileBtn.style.display = togglePostFiles.checked ? "" : "none";
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
  const gifBtn = document.getElementById("gif-btn");
  let gifFeatureEnabled = localStorage.getItem("gifFeatureEnabled") !== "false";
  if (toggleGifFeature) toggleGifFeature.checked = gifFeatureEnabled;
  gifBtn.style.display = gifFeatureEnabled ? "" : "none";
  if (toggleGifFeature) {
    toggleGifFeature.addEventListener("change", () => {
      gifFeatureEnabled = toggleGifFeature.checked;
      localStorage.setItem("gifFeatureEnabled", gifFeatureEnabled);
      
      if (gifBtn) gifBtn.style.display = gifFeatureEnabled ? "" : "none";
      document.getElementById("giphy-picker").style.display = "none";
    });
  }


  togglePostFiles.addEventListener("change", () => {
    localStorage.setItem("togglePostFiles", togglePostFiles.checked);
    if (!togglePostFiles.checked) {
      fileInput.value = "";
      fileUploadLabel.textContent = "📎 Choose File";
      sendFileBtn.style.display = "none";
      attachFileBtn.style.display = "none"; 
      attachPreview.innerHTML = "";
      attachedFile = null;
    } else {
      attachFileBtn.style.display = ""; 
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



attachFileBtn.addEventListener("click", () => {
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    attachedFile = fileInput.files[0];
    showAttachPreview();
  } else {
    attachedFile = null;
    attachPreview.innerHTML = "";
  }
});

document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    document.activeElement !== msg &&
    !e.ctrlKey && !e.altKey && !e.metaKey &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
  ) {
    e.preventDefault();
    msg.focus();
  }
});

document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (let item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        attachedFile = file;
        showAttachPreview();
      }
    }
  }
});

function showAttachPreview() {
  if (attachPreviewUrl) {
    URL.revokeObjectURL(attachPreviewUrl);
    attachPreviewUrl = null;
  }
  if (!attachedFile) {
    attachPreview.innerHTML = "";
    return;
  }
  const fileExt = attachedFile.name.split('.').pop().toLowerCase();
  const isImage = attachedFile.type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"].includes(fileExt);
  const safeName = escapeHtml(attachedFile.name || "Untitled file");
  const fileDetails = `${fileExt ? fileExt.toUpperCase() : "FILE"} · ${formatBytes(attachedFile.size)}`;

  if (isImage) {
    attachPreviewUrl = URL.createObjectURL(attachedFile);
    attachPreview.innerHTML = `
      <article class="attachment-preview attachment-preview--image">
        <div class="attachment-preview-media">
          <img src="${attachPreviewUrl}" alt="${safeName}">
        </div>
        <div class="attachment-preview-info">
          <span class="attachment-preview-label">Attached image</span>
          <strong class="attachment-preview-name" title="${safeName}">${safeName}</strong>
          <span class="attachment-preview-details">${fileDetails}</span>
        </div>
        <button id="remove-attach-btn" class="attachment-preview-remove" type="button" title="Remove attachment" aria-label="Remove attachment">&times;</button>
      </article>`;
  } else {
    attachPreview.innerHTML = `
      <article class="attachment-preview attachment-preview--file">
        <span class="attachment-preview-file-icon">📄</span>
        <div class="attachment-preview-info">
          <span class="attachment-preview-label">Attached file</span>
          <strong class="attachment-preview-name" title="${safeName}">${safeName}</strong>
          <span class="attachment-preview-details">${fileDetails}</span>
        </div>
        <button id="remove-attach-btn" class="attachment-preview-remove" type="button" title="Remove attachment" aria-label="Remove attachment">&times;</button>
      </article>`;
  }

  attachPreview.querySelector("#remove-attach-btn").onclick = () => {
    attachedFile = null;
    fileInput.value = "";
    if (attachPreviewUrl) URL.revokeObjectURL(attachPreviewUrl);
    attachPreviewUrl = null;
    attachPreview.innerHTML = "";
  };
}


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



  let mentionPopup = null;
  let mentionIndex = 0;
  let mentionList = [];

  msg.addEventListener("input", function(e) {
    const cursor = msg.selectionStart;
    const text = msg.value.slice(0, cursor);
    const atMatch = text.match(/@(\w*)$/);
    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      mentionList = currentUsers
        .map(u => u.nick)
        .filter(n => n.toLowerCase().startsWith(query) && n !== nick);
      if (!mentionList.length) {
        if (mentionPopup) mentionPopup.remove();
        mentionPopup = null;
        return;
      }
      if (!mentionPopup) {
        mentionPopup = document.createElement("div");
        mentionPopup.className = "mention-popup";
        mentionPopup.style.position = "absolute";
        mentionPopup.style.zIndex = 9999;
        mentionPopup.style.background = document.body.classList.contains("dark") ? "#23232b" : "#fff";
        mentionPopup.style.color = document.body.classList.contains("dark") ? "#eee" : "#222";
        mentionPopup.style.border = "1.5px solid #3399ff";
        mentionPopup.style.borderRadius = "7px";
        mentionPopup.style.boxShadow = "0 2px 12px rgba(0,0,0,0.13)";
        mentionPopup.style.padding = "6px 0";
        mentionPopup.style.fontSize = "1em";
        mentionPopup.style.minWidth = "120px";
        mentionPopup.style.maxHeight = "180px";
        mentionPopup.style.overflowY = "auto";
        document.body.appendChild(mentionPopup);
      }
      mentionPopup.innerHTML = mentionList.map((n, i) =>
        `<div class="mention-popup-item${i === mentionIndex ? " selected" : ""}" style="padding:4px 16px;cursor:pointer;background:${i === mentionIndex ? "#3399ff22" : "none"};">${escapeHtml(n)}</div>`
      ).join("");
      const rect = msg.getBoundingClientRect();
      mentionPopup.style.left = rect.left + window.scrollX + "px";
      mentionPopup.style.top = (rect.bottom + window.scrollY + 2) + "px";
    } else {
      if (mentionPopup) mentionPopup.remove();
      mentionPopup = null;
      mentionList = [];
      mentionIndex = 0;
    }
  });

  msg.addEventListener("keydown", function(e) {
    if (!mentionPopup) return;
    if (e.key === "ArrowDown") {
      mentionIndex = (mentionIndex + 1) % mentionList.length;
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      mentionIndex = (mentionIndex - 1 + mentionList.length) % mentionList.length;
      e.preventDefault();
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      const cursor = msg.selectionStart;
      const text = msg.value.slice(0, cursor);
      const atMatch = text.match(/@(\w*)$/);
      if (atMatch) {
        const before = msg.value.slice(0, cursor - atMatch[0].length);
        const after = msg.value.slice(cursor);
        msg.value = before + "@" + mentionList[mentionIndex] + " " + after;
        msg.selectionStart = msg.selectionEnd = (before + "@" + mentionList[mentionIndex] + " ").length;
      }
      mentionPopup.remove();
      mentionPopup = null;
      mentionList = [];
      mentionIndex = 0;
    } else if (e.key === "Escape") {
      mentionPopup.remove();
      mentionPopup = null;
      mentionList = [];
      mentionIndex = 0;
    }
    if (mentionPopup) {
      mentionPopup.querySelectorAll(".mention-popup-item").forEach((el, i) => {
        el.classList.toggle("selected", i === mentionIndex);
        el.style.background = i === mentionIndex ? "#3399ff22" : "none";
      });
    }
  });

  document.addEventListener("mousedown", function(e) {
    if (mentionPopup && e.target.classList.contains("mention-popup-item")) {
      const name = e.target.textContent;
      const cursor = msg.selectionStart;
      const text = msg.value.slice(0, cursor);
      const atMatch = text.match(/@(\w*)$/);
      if (atMatch) {
        const before = msg.value.slice(0, cursor - atMatch[0].length);
        const after = msg.value.slice(cursor);
        msg.value = before + "@" + name + " " + after;
        msg.selectionStart = msg.selectionEnd = (before + "@" + name + " ").length;
      }
      mentionPopup.remove();
      mentionPopup = null;
      mentionList = [];
      mentionIndex = 0;
      msg.focus();
    }
  });

  document.getElementById("admin-modal-close").onclick = () => {
  document.getElementById("admin-modal").style.display = "none";
};

document.getElementById("admin-modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("admin-modal")) {
    document.getElementById("admin-modal").style.display = "none";
  }
});

function adminAction(action) {
  const adminModal = document.getElementById("admin-modal");
  const user = adminModal.getAttribute("data-user");
  if (!user) return;
  ws.send(JSON.stringify({ type: "admin", action, user }));
  adminModal.style.display = "none";
}

document.getElementById("admin-mute-btn").onclick = () => adminAction("mute");
document.getElementById("admin-unmute-btn").onclick = () => adminAction("unmute");
document.getElementById("admin-kick-btn").onclick = () => adminAction("kick");
document.getElementById("admin-ban-btn").onclick = () => adminAction("ban");
document.getElementById("admin-flash-btn").onclick = () => {
  let site = prompt("Enter the site URL to open in fullscreen for this user:");
  if (!site) return;
  if (!/^https?:\/\//i.test(site)) {
    site = "https://" + site;
  }
  const adminModal = document.getElementById("admin-modal");
  const user = adminModal.getAttribute("data-user");
  if (!user) return;
  ws.send(JSON.stringify({ type: "admin", action: "flash", user, site }));
  adminModal.style.display = "none";
};
document.getElementById("admin-make-admin-btn").onclick = () => {
  const adminModal = document.getElementById("admin-modal");
  const user = adminModal.getAttribute("data-user");
  if (!user) return;
  ws.send(JSON.stringify({ type: "admin", action: "make-admin", user }));
  adminModal.style.display = "none";
};
document.getElementById("admin-remove-admin-btn").onclick = () => {
  const adminModal = document.getElementById("admin-modal");
  const user = adminModal.getAttribute("data-user");
  if (!user) return;
  ws.send(JSON.stringify({ type: "admin", action: "remove-admin", user }));
  adminModal.style.display = "none";
};
});



const chatVideoObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });
}, {
  root: chat,
  threshold: 0.1 
});

function observeChatVideos() {
  chat.querySelectorAll("video").forEach(video => {
    chatVideoObserver.observe(video);
  });
}

const chatMutationObs = new MutationObserver(() => {
  observeChatVideos();
  refreshEncryptionColors();
});

function isFileAttachmentMessage(message) {
  return typeof message?.text === "string" && /^📎 <a href="[^"]+"[^>]*>[^<]+<\/a>(?:<br>[\s\S]+)?$/.test(message.text);
}

function refreshEncryptionColors() {
  chat.querySelectorAll("[data-original]").forEach(div => {
    const message = JSON.parse(div.dataset.original);
    div.classList.remove("message-plain", "message-encrypted", "message-locked", "message-wrong-key");
    const isAttachment = isFileAttachmentMessage(message);
    div.classList.toggle("attachment-message", isAttachment);
    if (isAttachment) return;
    if (!encryptionColorsEnabled) return;
    if (message.encryptionState === "decrypted") div.classList.add("message-encrypted");
    else if (message.encryptionState === "locked") div.classList.add("message-locked");
    else if (message.encryptionState === "wrong-key") div.classList.add("message-wrong-key");
    else div.classList.add("message-plain");
  });
}

chatMutationObs.observe(chat, { childList: true, subtree: true });

observeChatVideos();


if (recoverBtn) {
  recoverBtn.addEventListener("click", () => {
    showChatLoading("Loading chat history...");
    safeSend({ type: "get-history" });
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
  return Math.round(bytes) + " B";
}

function formatTransferRate(bytesPerSecond) {
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}

function getUploadUrl(filename) {
  return new URL(`/uploads/${encodeURIComponent(filename)}`, window.location.origin).href;
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

msg.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    if (attachedFile) {
      e.preventDefault();
      uploadAttachedFile();
      return;
    }
    e.preventDefault();
    sendMessage();
  }
});
send.onclick = sendMessage;

async function sendMessage() {
  if (attachedFile) {
    uploadAttachedFile();
    return;
  }
  const text = msg.value;
  if (!text.trim()) return;
  const encrypted = await encryptChatMessage(text);
  if (!encrypted) return;
  let payload = { type: "message", nick, ...encrypted };
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

function uploadAttachedFile() {
  if (!attachedFile || uploadInProgress) return;
  uploadInProgress = true;
  sendFileBtn.classList.add("send-file-loading");
  sendFileBtn.disabled = true;
  sendFileBtn.innerHTML = 'Sending... <span class="spinner"></span>';

  const formData = new FormData();
  formData.append("file", attachedFile);

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/upload");

  xhr.onload = async function () {
    uploadInProgress = false;
    sendFileBtn.classList.remove("send-file-loading");
    sendFileBtn.disabled = false;
    sendFileBtn.innerHTML = "Send File";
    if (xhr.status === 200) {
      const savedName = xhr.responseText.trim();
      const url = getUploadUrl(savedName);
      let text = msg.value.trim();
      let messageText = `📎 <a href="${url}" target="_blank">${savedName}</a>`;
      if (text) messageText += `<br>${escapeHtml(text)}`;
      // Attachments stay visible to every participant; only normal chat messages use E2E encryption.
      let payload = { type: "message", nick, text: messageText };
      if (msg.dataset.replyTo) {
        payload.replyTo = msg.dataset.replyTo;
      }
      ws.send(JSON.stringify(payload));
      msg.value = "";
      msg.dataset.replyTo = "";
      let replyPreview = document.getElementById('reply-preview');
      if (replyPreview) replyPreview.remove();
      attachedFile = null;
      fileInput.value = "";
      attachPreview.innerHTML = "";
      sendFileBtn.style.display = "none";
      if (toggleFileLinks.checked && fileListDiv.style.display !== "none") fetchFileList();
      updateClearFilesBtn();
    } else {
      showError(xhr.status === 429 ? "Please wait a moment before uploading another file." : "Failed to upload file");
    }
  };

  xhr.onerror = function () {
    uploadInProgress = false;
    sendFileBtn.classList.remove("send-file-loading");
    sendFileBtn.disabled = false;
    sendFileBtn.innerHTML = "Send File";
    alert("Failed to upload file");
  };

  xhr.send(formData);
}
code.onclick = async () => {
  const selected = msg.value.slice(msg.selectionStart, msg.selectionEnd);
  const content = (selected || msg.value).trim();
  if (!content) {
    showError("Cannot send empty code!");
    return;
  }
  let lang = codeLang.value;
  let wrapped;
  if (lang && lang !== "plaintext") {
    wrapped = "```" + lang + "\n" + content + "```";
  } else {
    wrapped = "```plaintext\n" + content + "```";
  }
  const encrypted = await encryptChatMessage(wrapped);
  if (!encrypted) return;
  ws.send(JSON.stringify({ type: "message", nick, ...encrypted }));
  msg.value = "";
  setTimeout(() => {
    chat.scrollTop = chat.scrollHeight;
  }, 50);
};

ws.onopen = () => {
  const savedToken = localStorage.getItem("sessionToken");

  if (savedToken) {
    ws.send(JSON.stringify({ type: "session-login", token: savedToken }));
  } else {
    showEntryScreen();
  }
};

ws.onmessage = async (event) => {
  let data = JSON.parse(event.data);
  if (data.type === "message") {
    data = await decryptChatMessage(data);
    if (!data) return;
    if (hideUnreadableEncrypted && (data.encryptionState === "locked" || data.encryptionState === "wrong-key")) return;
  }
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
  if (data.type === "login-success" || data.type === "register-success") {
    loggedInUser = data.username;
    hideEntryScreen();
    const savedChatKey = sessionStorage.getItem("lanChatE2EKey");
    if (savedChatKey && accountPassword) saveChatKeyToProfile(savedChatKey);
    localStorage.setItem("loggedInUser", data.username);
    localStorage.setItem("sessionToken", data.token);
    updateLoginUI();
    closeModal();
    ws.send(JSON.stringify({
      type: "get-settings",
      username: loggedInUser
    }));
    ws.send(JSON.stringify({
      type: "get-favorites",
      username: loggedInUser
    }));
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "join", nick: loggedInUser, Force: true }));
    } else {
        ws.addEventListener("open", () => {
            ws.send(JSON.stringify({ type: "join", nick: loggedInUser, Force: true }));
        }, { once: true });
    }
    if (window.PasswordCredential) {
      const cred = new PasswordCredential({
        id: document.getElementById("login-username").value,
        password: document.getElementById("login-password").value
      });
      navigator.credentials.store(cred).catch(() => {});
    }
  }
  if (data.type === "duplicate-session") {
    let but = document.getElementById("login-toggle-btn");
    if (but) but.style.display = "none";
    document.body.innerHTML = `
      <div style="
        display:flex;
        flex-direction:column;
        justify-content:center;
        align-items:center;
        height:100vh;
        width:100vw;
        background:#222;
        color:white;
        font-size:1.5em;
        text-align:center;
        padding:20px;
        box-sizing:border-box;
      ">
        This session is already active in another tab.<br>
        Please close this tab and log in from another one.<br><br>
        <button id="force-logout-btn" style="margin-top:24px;padding:12px 32px;font-size:1em;background:#dc3545;color:#fff;border:none;border-radius:8px;cursor:pointer;">Log out this account</button>
      </div>
    `;
    setTimeout(() => {
      const btn = document.getElementById("force-logout-btn");
      if (btn) {
        btn.onclick = () => {
          const username = localStorage.getItem("loggedInUser");
          const token = localStorage.getItem("sessionToken");
          if (username && token) {
            const ws2 = new WebSocket(`ws://${location.hostname}:6789`);
            ws2.onopen = () => {
              ws2.send(JSON.stringify({
                type: "logout-session",
                username,
                token
              }));
              ws2.close();
              localStorage.removeItem("loggedInUser");
              localStorage.removeItem("sessionToken");
              setTimeout(() => window.location.reload(), 1000);
            };
          } else {
            window.location.reload();
          }
        };
      }
    }, 100);
  }
  if (data.type === "auth-error") {
    loggedInUser = null;
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("sessionToken");
    const loginToggleBtn = document.getElementById("login-toggle-btn");
    loginToggleBtn.textContent = "🔑 Log in";
    showError(data.message || "Login failed. Wrong username or password.");
    if (data.message == "Invalid or expired session") {
      showEntryScreen();
    }
  }
  if (data.type === "history-available") {
    if (autoRecover) {
      if (data.available) {
        safeSend({ type: "get-history" });
      } else {
        hideChatLoading();
      }
      if (recoverBtn) recoverBtn.style.display = "none";
    } else if (recoverBtn) {
      recoverBtn.style.display = data.available ? "inline-block" : "none";
    }
    return;
  }
  if (data.type === "history") {
    if (encryptionFeaturesEnabled && autoRecover) {
      showChatLoading("Checking encrypted messages...");
      await waitForEncryptionSetup();
    }
    chat.innerHTML = "";
    let encryptedCount = 0;
    let decryptedCount = 0;
    let failedCount = 0;
    for (const encryptedMessage of data.messages || []) {
      if (encryptedMessage.encrypted) encryptedCount++;
      const msgData = await decryptChatMessage(encryptedMessage);
      if (!msgData) continue;
      if (msgData.encryptionState === "decrypted") decryptedCount++;
      if (msgData.encryptionState === "wrong-key" || msgData.encryptionState === "locked") failedCount++;
      if (hideUnreadableEncrypted && (msgData.encryptionState === "locked" || msgData.encryptionState === "wrong-key")) continue;
      const div = document.createElement("div");
      div.id = "msg-" + msgData.timestamp;
      div.dataset.timestamp = msgData.timestamp;
      div.dataset.original = JSON.stringify(msgData);
      if (checkifdeleted(msgData)) {
        div.classList.add("file-deleted");
      }
      div.innerHTML = formatMessage(msgData);
      chat.appendChild(div);
    }
    const imgs = chat.querySelectorAll("img");
    if (imgs.length) {
      let loaded = 0;
      imgs.forEach(img => {
        if (img.complete) {
          loaded++;
          if (loaded === imgs.length) chat.scrollTop = chat.scrollHeight;
        } else {
          img.addEventListener("load", () => {
            loaded++;
            if (loaded === imgs.length) chat.scrollTop = chat.scrollHeight;
          });
          img.addEventListener("error", () => {
            loaded++;
            if (loaded === imgs.length) chat.scrollTop = chat.scrollHeight;
          });
        }
      });
    } else {
      chat.scrollTop = chat.scrollHeight;
    }

    if (window.Prism) Prism.highlightAll();
    updateDeletedFilesInChat();
    hideChatLoading();
    if (encryptionRecheckPending) {
      encryptionRecheckPending = false;
      setEncryptionStatus(
        encryptedCount
          ? `Recheck complete: found ${encryptedCount} encrypted message${encryptedCount === 1 ? "" : "s"}; decrypted ${decryptedCount}, unavailable ${failedCount}.`
          : "Recheck complete: no encrypted messages were found."
      , failedCount > 0);
    } else if (encryptedCount) {
      setEncryptionStatus(
        `Encryption check: found ${encryptedCount} encrypted message${encryptedCount === 1 ? "" : "s"}; matched ${decryptedCount}, unavailable ${failedCount}.`,
        failedCount > 0
      );
    }
    return;
  }
  if (data.type === "flash" && data.site) {
    const win = window.open(data.site, "_blank");
    if (win) {
      win.focus();
      win.onload = () => {
        if (win.document.documentElement.requestFullscreen) {
          win.document.documentElement.requestFullscreen().catch(() => {});
        }
      };
    } else {
      alert("Popup blocked! Please allow popups for this site.");
    }
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
    div.id = "msg-" + data.timestamp;
    div.dataset.original = JSON.stringify(data);
    div.innerHTML = formatMessage(data);
    chat.appendChild(div);
 
    requestAnimationFrame(() => {
      if (wasAtBottom) {
        chat.scrollTop = chat.scrollHeight;
      }
    });

    const imgs = div.querySelectorAll("img");
    if (imgs.length) {
      let loaded = 0;
      imgs.forEach(img => {
        if (img.complete) {
          loaded++;
          if (loaded === imgs.length && wasAtBottom) {
            chat.scrollTop = chat.scrollHeight;
          }
        } else {
          img.addEventListener("load", () => {
            loaded++;
            if (loaded === imgs.length && wasAtBottom) {
              chat.scrollTop = chat.scrollHeight;
            }
          });
          img.addEventListener("error", () => {
            loaded++;
            if (loaded === imgs.length && wasAtBottom) {
              chat.scrollTop = chat.scrollHeight;
            }
          });
        }
      });
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
  if (data.type === "user-favorites") {
    userFavorites = data.favorites || [];
  }
  if (data.type === "files-cleared") {
    if (toggleFileLinks.checked && fileListDiv.style.display !== "none") {
      fetchFileList();
    }
  }
  if (data.type === "user-settings") {
    const settings = data.settings || {};
    if ("encryptionFeaturesEnabled" in settings) {
      encryptionFeaturesEnabled = settings.encryptionFeaturesEnabled;
      toggleEncryptionFeatures.checked = encryptionFeaturesEnabled;
      localStorage.setItem("encryptionFeaturesEnabled", encryptionFeaturesEnabled);
      updateEncryptionSettingsLock();
      if (!encryptionFeaturesEnabled) {
        chatCryptoKey = null;
        if (chatEncryptionKeyInput) chatEncryptionKeyInput.value = "";
        hideChatLoading();
        safeSend({ type: "get-history" });
      }
    }
    if ("gifFeatureEnabled" in settings) {
      toggleGifFeature.checked = settings.gifFeatureEnabled;
      gifFeatureEnabled = settings.gifFeatureEnabled;
      const gifBtn = document.getElementById("gif-btn");
      if (gifBtn) gifBtn.style.display = gifFeatureEnabled ? "" : "none";
    }
    if ("color" in settings) {
      customNickColorInput.value = settings.color;
      localStorage.setItem("customNickColor", settings.color);
    }
    if ("darkMode" in settings) {
      darkModeToggle.checked = settings.darkMode;
      localStorage.setItem("darkMode", settings.darkMode);
      if (settings.darkMode) document.body.classList.add("dark");
      else document.body.classList.remove("dark");
    }
    if ("showTimestamps" in settings) {
      toggleTimestamps.checked = settings.showTimestamps;
      localStorage.setItem("showTimestamps", settings.showTimestamps);
    }
    if ("showFileLinks" in settings) {
      toggleFileLinks.checked = settings.showFileLinks;
      localStorage.setItem("showFileLinks", settings.showFileLinks);
      fileListDiv.style.display = settings.showFileLinks ? "block" : "none";
    }
    if ("showReplyBtn" in settings) {
      toggleReplyBtn.checked = settings.showReplyBtn;
      localStorage.setItem("showReplyBtn", settings.showReplyBtn);
    }
    if ("showImagePreview" in settings) {
      toggleImagePreview.checked = settings.showImagePreview;
      localStorage.setItem("showImagePreview", settings.showImagePreview);
    }
    if ("postFiles" in settings) {
      togglePostFiles.checked = settings.postFiles;
      localStorage.setItem("togglePostFiles", settings.postFiles);
      sendFileBtn.style.display = settings.postFiles ? "" : "none";
      attachFileBtn.style.display = settings.postFiles ? "" : "none";
    }
    if ("autoRecover" in settings) {
      toggleAutoRecover.checked = settings.autoRecover;
      autoRecover = settings.autoRecover;
      localStorage.setItem("autoRecover", autoRecover);
      if (recoverBtn) {
        recoverBtn.style.display = autoRecover ? "none" : "inline-block";
      }
    }
    if ("e2eEncryptionEnabled" in settings) {
      encryptionEnabled = settings.e2eEncryptionEnabled;
      toggleE2EEncryption.checked = encryptionEnabled;
      localStorage.setItem("e2eEncryptionEnabled", encryptionEnabled);
    }
    if ("e2eEncryptionMode" in settings) {
      encryptionMode = settings.e2eEncryptionMode;
      encryptionModeSelect.value = encryptionMode;
      localStorage.setItem("e2eEncryptionMode", encryptionMode);
    }
    if ("encryptionColorsEnabled" in settings) {
      encryptionColorsEnabled = settings.encryptionColorsEnabled;
      toggleEncryptionColors.checked = encryptionColorsEnabled;
      localStorage.setItem("encryptionColorsEnabled", encryptionColorsEnabled);
    }
    if ("hideUnreadableEncrypted" in settings) {
      hideUnreadableEncrypted = settings.hideUnreadableEncrypted;
      toggleHideUnreadableEncrypted.checked = hideUnreadableEncrypted;
      localStorage.setItem("hideUnreadableEncrypted", hideUnreadableEncrypted);
    }
    if (encryptionFeaturesEnabled && !chatCryptoKey) {
      const profileKey = decryptKeyFromProfile(settings.encryptedChatKey);
      const savedChatKey = profileKey || sessionStorage.getItem("lanChatE2EKey");
      if (savedChatKey) {
        setChatEncryptionKey(savedChatKey, {
          automatic: true,
          requestHistory: true
        });
      }
    }
    [...chat.children].forEach(div => {
      const originalData = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (originalData) {
        div.innerHTML = formatMessage(originalData);
      }
    });
  }
  if (data.type === "kicked" && data.reason === "duplicate") {
    alert("You have been disconnected because this account logged in elsewhere.");
    loggedInUser = null;
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("sessionToken");
    updateLoginUI();
    window.location.reload();
}
  if (data.type === "kicked") {
    function sayAndReload(message) {
      if (confirm(message)) {
        window.location.reload();
      }
    }
    if (data.reason === "kicked") {
        sayAndReload("You have been kicked from the chat.");
      } else if (data.reason === "banned") {
        sayAndReload("You have been BANNED from the chat.");
      } else {
        sayAndReload("You have been kicked but idk why tbh from the chat.");
      }
  }
  if (data.type === "IP") {
    const ip = document.getElementById("LAN");
    let mutedUsers = new Set(data.muted || []);
    let verifiedUsers = new Set(data.verified || []);
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
      currentUsers.forEach(user => {
        userColors[user.nick] = user.color;
        if (user.nick === nick) myColor = user.color;
        const li = document.createElement("li");
        li.textContent = user.nick;
        li.title = user.nick;
        if (user.color) li.style.color = user.color;
        if (user.nick === nick) li.style.fontWeight = "bold";
        if (mutedUsers.has(user.nick)) {
          const mutedIcon = document.createElement("span");
          mutedIcon.textContent = "🔇";
          mutedIcon.title = "Muted";
          mutedIcon.style.marginRight = "4px";
          li.insertBefore(mutedIcon, li.firstChild);
        }
        if (verifiedUsers.has(user.nick)) {
          const verifiedIcon = document.createElement("span");
          verifiedIcon.textContent = "✔️";
          verifiedIcon.title = "Verified";
          verifiedIcon.style.marginRight = "4px";
          li.insertBefore(verifiedIcon, li.firstChild);
        }

        if (adminUsers.has(user.nick)) {
          const adminIcon = document.createElement("span");
          adminIcon.textContent = "🛡️";
          adminIcon.title = "Admin";
          adminIcon.style.marginRight = "4px";
          li.insertBefore(adminIcon, li.firstChild);
        }

        if (is_admin) {
          const moreBtn = document.createElement("button");
          moreBtn.textContent = "⋮";
          moreBtn.title = "More options";
          moreBtn.className = "user-action-btn more-options-btn";
          moreBtn.onclick = (e) => {
            e.stopPropagation();
            const adminModal = document.getElementById("admin-modal");
            const adminModalUser = document.getElementById("admin-modal-user");
            adminModalUser.textContent = user.nick;
            adminModal.style.display = "flex";
            adminModal.setAttribute("data-user", user.nick);
          };
          if (!is_admin) {
            const adminModal = document.getElementById("admin-modal");
            if (adminModal) adminModal.style.display = "none";
          }
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
  if (data.type === "settings-saved") {
    showError("Settings saved!");
  }
  if (data.type === "password-changed") {
    if (pendingAccountPassword) {
      accountPassword = pendingAccountPassword;
      pendingAccountPassword = null;
      const savedChatKey = sessionStorage.getItem("lanChatE2EKey");
      if (savedChatKey) saveChatKeyToProfile(savedChatKey);
    }
    showError("Password changed!");
    document.getElementById("account-change-password-form").style.display = "none";
  }
  if (data.type === "sessions-list") {
    const accountSessionsListDiv = document.getElementById("account-sessions-list");
    if (accountSessionsListDiv) {
      accountSessionsListDiv.innerHTML = "";
      if (!data.sessions.length) {
        accountSessionsListDiv.innerHTML = "<em>No active sessions.</em>";
      } else {
        data.sessions.forEach(sess => {
          const div = document.createElement("div");
          div.style.marginBottom = "8px";
          div.innerHTML = `
            <b>IP:</b> ${sess.ip} <b>Timestamp:</b> ${sess.timestamp} <b>Token:</b> ${sess.token}
            ${sess.current ? '<span style="color:#007bff;font-weight:bold;">(This session)</span>' : ''}
            <button class="account-logout-session-btn" data-token="${sess.token}" style="margin-left:10px;">Log out</button>
          `;
          accountSessionsListDiv.appendChild(div);
        });
        accountSessionsListDiv.querySelectorAll(".account-logout-session-btn").forEach(btn => {
          btn.onclick = () => {
            ws.send(JSON.stringify({
              type: "logout-session",
              username: loggedInUser,
              token: btn.dataset.token
            }));
          };
        });
      }
    }
  }
  if (data.type === "session-logged-out") {
    showError("Session logged out: " + data.token);
    ws.send(JSON.stringify({
      type: "get-sessions",
      username: loggedInUser
    }));
  }
  if (data.type === "system-message" && data.message) {
    showError(data.message); 
    const div = document.createElement("div");
    div.className = "system-message";
    div.innerHTML = `<span style="color:#5865f2;font-weight:bold;">${escapeHtml(data.message)}</span>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return;
  }

  if (data.type === "Denied" && data.message) {
    showError(data.message); 
    const div = document.createElement("div");
    div.className = "system-message";
    div.innerHTML = `<span style="color:#dc3545;font-weight:bold;">${escapeHtml(data.message)}</span>`;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return;
  }

  if (data.type === "users") {
    currentUsers = data.users || [];
    let mutedUsers = new Set(data.muted || []);
    let verifiedUsers = new Set(data.verified || []);
    adminUsers = new Set(currentUsers.filter(u => u.is_admin).map(u => u.nick));
    is_admin = adminUsers.has(nick);
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
      if (verifiedUsers.has(user.nick)) {
        const verifiedIcon = document.createElement("span");
        verifiedIcon.textContent = "✔️";
        verifiedIcon.title = "Verified";
        verifiedIcon.style.marginRight = "4px";
        li.insertBefore(verifiedIcon, li.firstChild);
      }
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
      if (!is_admin) {
        const adminModal = document.getElementById("admin-modal");
        if (adminModal) adminModal.style.display = "none";
      }
      if (is_admin) {
        const moreBtn = document.createElement("button");
        moreBtn.textContent = "⋮";
        moreBtn.title = "More options";
        moreBtn.className = "user-action-btn more-options-btn";
        moreBtn.onclick = (e) => {
          e.stopPropagation();
          const adminModal = document.getElementById("admin-modal");
          const adminModalUser = document.getElementById("admin-modal-user");
          adminModalUser.textContent = user.nick;
          adminModal.style.display = "flex";
          adminModal.setAttribute("data-user", user.nick);
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
        a.href = getUploadUrl(fname);
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
  if (!file || uploadInProgress) return;
  uploadInProgress = true;

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
    uploadInProgress = false;
    sendFileBtn.classList.remove("send-file-loading");
    sendFileBtn.disabled = false;
    sendFileBtn.innerHTML = "Send File";
    tracker.textContent = "";
    if (xhr.status === 200) {
      const savedName = xhr.responseText.trim();
      const url = getUploadUrl(savedName);
      
      // Attachments stay visible to every participant; only normal chat messages use E2E encryption.
      let payload = { type: "message", nick, text: `📎 <a href="${url}" target="_blank">${savedName}</a>` };
      if (msg.dataset.replyTo) {
        payload.replyTo = msg.dataset.replyTo;
      }
      ws.send(JSON.stringify(payload));
      msg.dataset.replyTo = "";
      let replyPreview = document.getElementById('reply-preview');
      if (replyPreview) replyPreview.remove();
      fileInput.value = ""; 
      fileUploadLabel.textContent = "📎 Choose File";
      sendFileBtn.style.display = "none";
      if (toggleFileLinks.checked && fileListDiv.style.display !== "none") fetchFileList();
      updateClearFilesBtn();
    } else {
      showError(xhr.status === 429 ? "Please wait a moment before uploading another file." : "Failed to upload file");
    }
  };

  xhr.onerror = function () {
    uploadInProgress = false;
    sendFileBtn.classList.remove("send-file-loading");
    sendFileBtn.disabled = false;
    sendFileBtn.innerHTML = "Send File";
    tracker.textContent = "";
    alert("Failed to upload file");
  };

  xhr.send(formData);
}
function linkify(text) {
  if (!text) return "";
  const urlPattern = /(\bhttps?:\/\/[^\s<]+)/gi;
  return text.replace(urlPattern, '<a href="$1" target="_blank">$1</a>');
}
function formatMessage(data, forceDeleted = false) {
  let timestamp = showTimestamps && data.timestamp
    ? `<span class="timestamp">[${formatTime(data.timestamp)}]</span> `
    : "";

    let replyBtn = "";
  if (showReplyBtn) {
    replyBtn = `<button class="reply-btn" data-timestamp="${data.timestamp}" style="margin-left:4px;font-size:0.75em;padding:1px 4px;background:#eee;border:1px solid #ccc;color:#444;border-radius:4px;cursor:pointer;line-height:1;">↩</button>`;
  }

  const nickColor =
    (userColors && userColors[data.nick]) ||
    (data.nick === nick && customNickColor) ||
    getUserColor(data.nick);
  const nickHtml = `<span class="chat-nick" style="color:${nickColor}">${escapeHtml(data.nick)}</span>:`;
  
  let text = data.text;

  const fileLinkMatch = text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<br>([\s\S]+))?$/);
  let replyHtml = "";
  if (data.replyTo) {
    let repliedMsg = null;
    [...chat.children].forEach(div => {
      const original = div.dataset.original ? JSON.parse(div.dataset.original) : null;
      if (original && original.timestamp === data.replyTo) repliedMsg = original;
    });
    if (repliedMsg) {
      let preview = "";
      const fileMatch = repliedMsg.text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<br>([\s\S]+))?$/);
      const codeMatch = repliedMsg.text.match(/^```(\w+)?\n?([\s\S]*?)```$/);
      const imgMatch = repliedMsg.text.trim().match(/^<img\s+src="([^"]+)"[^>]*>$/i);
      const urlMatch = repliedMsg.text.trim().match(/^(https?:\/\/[^\s<]+?\.(gif|png|jpe?g|webp|bmp|svg)(\?.*)?)$/i);
      const videoMatch = repliedMsg.text.trim().match(/^(https?:\/\/[^\s<]+?\.mp4(\?.*)?)$/i);

      if (fileMatch) {
        let url = fileMatch[1];
        if (deletedFiles.has(fileMatch[2]) || forceDeleted) {
          url = "#";
        }
        const filename = fileMatch[2];
        const extraText = fileMatch[3] ? fileMatch[3].trim() : "";
        const fileExt = filename.split('.').pop().toLowerCase();
        const isImage = ["jpg","jpeg","png","gif","webp"].includes(fileExt);
        if (isImage) {
          preview = `<img src="${url}" alt="${escapeHtml(filename)}" style="max-width:38px;max-height:38px;vertical-align:middle;margin-left:8px;border-radius:5px;">`;
        } else {
          preview = `<span style="display:inline-flex;align-items:center;margin-left:8px;">
            <span style="font-size:1.1em;margin-right:4px;">📄</span>
            <span style="color:#888;font-size:0.95em;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;">${escapeHtml(filename.length > 32 ? filename.slice(0, 32) + "..." : filename)}</span>
          </span>`;
        }
        if (extraText) {
          preview += `<span style="margin-left:10px;color:${document.body.classList.contains("dark") ? "#eee" : "#444"};font-style:italic;">${escapeHtml(extraText.length > 60 ? extraText.slice(0, 60) + "..." : extraText)}</span>`;
        }
      } else if (codeMatch) {
        const code = codeMatch[2].split('\n')[0];
        preview = `<span style="display:inline-flex;align-items:center;margin-left:8px;">
          <span style="font-size:1.1em;margin-right:4px;">💻</span>
          <code class="reply-code-preview" style="background:${document.body.classList.contains("dark") ? "#222" : "#eee"};border-radius:3px;padding:2px 10px;font-size:0.98em;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;color:${document.body.classList.contains("dark") ? "#eee" : "#222"};">${escapeHtml(code.length > 180 ? code.slice(0, 180) + "..." : code)}</code>
        </span>`;
      } else if (imgMatch) {
        preview = `<img src="${imgMatch[1]}" alt="GIF" style="max-width:38px;max-height:38px;vertical-align:middle;margin-left:8px;border-radius:5px;"> <span style="color:#888;font-size:0.95em;">GIF</span>`;
      } else if (urlMatch) {
        preview = `<img src="${urlMatch[1]}" alt="GIF" style="max-width:38px;max-height:38px;vertical-align:middle;margin-left:8px;border-radius:5px;"> <span style="color:#888;font-size:0.95em;">GIF</span>`;
      } else if (videoMatch) {
        preview = `<span style="display:inline-block;vertical-align:middle;margin-left:8px;">
          <video src="${videoMatch[1]}" style="max-width:38px;max-height:38px;border-radius:5px;vertical-align:middle;" autoplay loop muted playsinline></video>
          <span style="color:#888;font-size:0.95em;">MP4</span>
        </span>`;
      }

      const replyText = escapeHtml(repliedMsg.text);
      let shortText = replyText.length > 80 ? replyText.slice(0, 80) + "..." : replyText;
      if (fileMatch || codeMatch || imgMatch || urlMatch || videoMatch) shortText = "";

      const isDark = document.body.classList.contains("dark");
      const replyBg = isDark ? "#232323" : "#f7f7f7";
      const replyBorder = isDark ? "#444" : "#ccc";
      const replyColor = isDark ? "#eee" : "#444";
      replyHtml = `
        <div class="reply-preview-in-chat reply-scroll-link"
            data-scrollto="msg-${data.replyTo}"
            style="cursor:pointer;display:flex;align-items:center;gap:10px;background:${replyBg};border-left:3px solid ${replyBorder};padding:3px 8px;margin-bottom:0;border-radius:5px;font-size:0.95em;line-height:1.2;">
          <span style="font-weight:500;color:#3399ff;min-width:110px;">↩ Replied to <span style="color:${userColors[repliedMsg.nick] || '#007bff'}">${escapeHtml(repliedMsg.nick)}</span>:</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${shortText} ${preview}</span>
        </div>`;
    }
  }

  if (fileLinkMatch) {
    let url = fileLinkMatch[1];
    if (deletedFiles.has(fileLinkMatch[2]) || forceDeleted) {
      url = "#";
    }
    const filename = fileLinkMatch[2];
    const extraText = fileLinkMatch[3] ? fileLinkMatch[3].trim() : "";
    const isDeleted = forceDeleted || deletedFiles.has(filename);

    const fileExt = filename.split('.').pop().toLowerCase();
    const isImage = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"].includes(fileExt);
    const previewEnabled = document.getElementById("toggle-image-preview")?.checked;
    const safeUrl = escapeHtml(url);
    const safeFilename = escapeHtml(filename);

    let fileCard = "";
    if (previewEnabled && isImage) {
      fileCard = `
        <article class="file-card file-card--image${isDeleted ? ' file-deleted' : ''}">
          <button class="file-image-preview" type="button" data-image-url="${safeUrl}" data-image-name="${safeFilename}" ${isDeleted ? "disabled" : ""} aria-label="Open ${safeFilename}">
            <img src="${safeUrl}" alt="${safeFilename}" loading="lazy" decoding="async">
          </button>
          <div class="file-card-meta">
            <span title="${safeFilename}" class="file-name">${safeFilename}${isDeleted ? ' (deleted)' : ''}</span>
            ${!isDeleted ? `<button class="file-download-btn" data-file-url="${safeUrl}" data-file-name="${safeFilename}">Download</button>` : ''}
          </div>
          <div class="download-progress" id="download-progress-${safeFilename}" style="display:none"></div>
        </article>`;
    } else {
      fileCard = `
        <article class="file-card file-card--document${isDeleted ? ' file-deleted' : ''}">
          <span class="file-icon">📄</span>
          <span title="${safeFilename}" class="file-name">${safeFilename}${isDeleted ? ' (deleted)' : ''}</span>
          ${!isDeleted ? `<button class="file-download-btn" data-file-url="${safeUrl}" data-file-name="${safeFilename}">Download</button>` : ''}
          <div class="download-progress" id="download-progress-${safeFilename}" style="display:none"></div>
        </article>`;
    }

    return `${replyHtml}${timestamp}${nickHtml}${extraText ? ` ${escapeHtml(extraText)} ${replyBtn}` : replyBtn}${fileCard}`;
  }

  const singleCodeMatch = text.trim().match(/^```(\w+)?\n?([\s\S]*?)```$/);
  if (singleCodeMatch) {
    let lang = singleCodeMatch[1] ? singleCodeMatch[1].toLowerCase() : "plaintext";
    const code = singleCodeMatch[2];
    return `${replyHtml}${timestamp}${nickHtml}${replyBtn}
      <div class="code-block">
        <pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>
        <button class="copy-btn" title="Copy code">Copy</button>
      </div>`;
  }
  if (/^<img\s+src="([^"]+)"[^>]*>$/i.test(data.text.trim())) {
    const imgMatch = data.text.trim().match(/^<img\s+src="([^"]+)"[^>]*>$/i);
    const src = imgMatch[1];
    const favs = userFavorites;
    const isFav = favs.includes(src);
    return `${replyHtml}${timestamp}${nickHtml}${replyBtn}
      <div class="chat-img-container" style="margin:8px 0;">
        <div class="chat-img-wrapper" style="position:relative; display:inline-block;">
          <img src="${src}" alt="GIF" class="chat-gif-img"
              style="max-width:220px;max-height:220px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.10);cursor:pointer;"
              onclick="openImageModal('${src}','GIF')">
          <button class="chat-gif-fav-btn${isFav ? ' fav' : ''}" data-gif="${src}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? "★" : "❤"}</button>
        </div>
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
  if (!fileLinkMatch && !singleCodeMatch) {

    let text = data.text.trim();

    if (/^(https?:\/\/[^\s<]+?\.(gif|png|jpe?g|webp|bmp|svg)(\?.*)?)$/i.test(text)) {
      const src = text;
      const favs = userFavorites;
      const isFav = favs.includes(src);
      return `${replyHtml}${timestamp}${nickHtml}${replyBtn}
      <div class="chat-img-container" style="margin:8px 0;">
        <div class="chat-img-wrapper" style="position:relative; display:inline-block;">
          <img src="${src}" alt="GIF" class="chat-gif-img"
              style="max-width:220px;max-height:220px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.10);cursor:pointer;"
              onclick="openImageModal('${src}','GIF')">
          <button class="chat-gif-fav-btn${isFav ? ' fav' : ''}" data-gif="${src}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? "★" : "❤"}</button>
        </div>
      </div>`;
    }
    if (/^(https?:\/\/[^\s<]+?\.mp4(\?.*)?)$/i.test(text)) {
      const src = text;
      const favs = userFavorites;
      const isFav = favs.includes(src);
      return `${replyHtml}${timestamp}${nickHtml}${replyBtn}
  <div class="chat-img-container" style="margin:8px 0;">
      <div class="chat-img-wrapper" style="position:relative; display:inline-block;">
        <video src="${src}" autoplay loop muted playsinline
          style="max-width:220px;max-height:220px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.10);cursor:pointer;"
          onclick="openImageModal('${src}','Video')"></video>
        <button class="chat-gif-fav-btn${isFav ? ' fav' : ''}" data-gif="${src}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? "★" : "❤"}</button>
      </div>
    </div>`;
    }
    let parts = text.split(/\s+/);
    let processedParts = parts.map(word => {
      const favs = userFavorites;
      const isFav = favs.includes(word);
      if (/https?:\/\/[^\s<]+?\.gif(\?.*)?/i.test(word)) {
        return `${replyHtml}${timestamp}${nickHtml}${replyBtn}
      <div class="chat-img-container" style="margin:8px 0;">
        <div class="chat-img-wrapper" style="position:relative; display:inline-block;">
          <img src="${word}" alt="GIF" class="chat-gif-img"
              style="max-width:220px;max-height:220px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.10);cursor:pointer;"
              onclick="openImageModal('${word}','GIF')">
          <button class="chat-gif-fav-btn${isFav ? ' fav' : ''}" data-gif="${word}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? "★" : "❤"}</button>
        </div>
      </div>`;
      } 
      else if (/https?:\/\/[^\s<]+?\.mp4(\?.*)?/i.test(word)) {
        return `${replyHtml}${timestamp}${nickHtml}${replyBtn}
     <div class="chat-img-container" style="margin:8px 0;">
    <div class="chat-img-wrapper" style="position:relative; display:inline-block;">
      <video src="${word}" autoplay loop muted playsinline
        style="max-width:220px; max-height:220px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.10); cursor:pointer;"
        onclick="openImageModal('${word}','Video')"></video>
      <button class="chat-gif-fav-btn${isFav ? ' fav' : ''}" data-gif="${word}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? "★" : "❤"}</button>
    </div>
  </div>`;
      }
      else if (/https?:\/\/[^\s<]+?\.(png|jpe?g|webp|bmp|svg)(\?.*)?/i.test(word) ||
              /https?:\/\/encrypted-tbn0\.gstatic\.com\/images/i.test(word)) {
        return `${replyHtml}${timestamp}${nickHtml}${replyBtn}
      <div class="chat-img-container" style="margin:8px 0;">
        <div class="chat-img-wrapper" style="position:relative; display:inline-block;">
          <img src="${word}" alt="Image" class="chat-gif-img"
              style="max-width:220px;max-height:220px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.10);cursor:pointer;"
              onclick="openImageModal('${word}','Image')">
        </div>
      </div>`;
      } 
      else if (/https?:\/\/[^\s<]+/i.test(word)) {
        return `<a href="${word}" target="_blank">${escapeHtml(word)}</a>`;
      } 
      else {
        return escapeHtml(word);
      }
  });

    processed = processedParts.join(' ');
    if (processed.includes('class="chat-img-container"')){
      return processed;
    }
  }
  const mentionRegex = new RegExp(`@${escapeHtml(nick)}\\b`, "gi");
  processed = processed.replace(mentionRegex, `<span class="mention mention-me">@${escapeHtml(nick)}</span>`);

  currentUsers.forEach(user => {
    if (user.nick !== nick) {
      const userMentionRegex = new RegExp(`@${escapeHtml(user.nick)}\\b`, "gi");
      processed = processed.replace(userMentionRegex, `<span class="mention">@${escapeHtml(user.nick)}</span>`);
    }
  });
  return `${replyHtml}${timestamp}${nickHtml} ${processed} ${replyBtn}`;
}

document.addEventListener('click', (e) => {
  const imagePreview = e.target.closest('.file-image-preview');
  if (imagePreview && !imagePreview.disabled) {
    openImageModal(imagePreview.dataset.imageUrl, imagePreview.dataset.imageName);
    return;
  }

  const downloadButton = e.target.closest('.file-download-btn[data-file-url]');
  if (downloadButton) {
    window.downloadFileWithProgress(downloadButton.dataset.fileUrl, downloadButton.dataset.fileName);
    return;
  }

  const link = e.target.closest('.reply-scroll-link');
  if (link && link.dataset.scrollto) {
    const target = document.getElementById(link.dataset.scrollto);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("highlight-reply");
      const replyFrame = target.querySelector('.reply-preview-in-chat');
      if (replyFrame) {
        replyFrame.classList.add("highlight-reply");
        setTimeout(() => replyFrame.classList.remove("highlight-reply"), 1200);
      }
      const codeBlock = target.querySelector('.code-block');
      if (codeBlock) {
        codeBlock.classList.add("highlight-reply");
        setTimeout(() => codeBlock.classList.remove("highlight-reply"), 1200);
      }
      const fileCard = target.querySelector('.file-card');
      if (fileCard) {
        fileCard.classList.add("highlight-reply");
        setTimeout(() => fileCard.classList.remove("highlight-reply"), 1200);
      }
      setTimeout(() => target.classList.remove("highlight-reply"), 1200);
    }
  }
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
    msg.focus();
    const ts = e.target.dataset.timestamp;
    const div = e.target.closest('div');
    const originalData = div?.dataset.original ? JSON.parse(div.dataset.original) : null;
    if (originalData) {
      let replyPreview = document.getElementById('reply-preview');
      if (!replyPreview) {
        replyPreview = document.createElement('div');
        replyPreview.id = 'reply-preview';
        replyPreview.style.display = "flex";
        replyPreview.style.alignItems = "center";
        replyPreview.style.gap = "10px";
        replyPreview.style.background = darkModeToggle.checked ? "#232323" : "#e9f3ff";
        replyPreview.style.color = darkModeToggle.checked ? "#eee" : "#222";
        replyPreview.style.border = `1.5px solid ${darkModeToggle.checked ? "#444" : "#ccc"}`;
        replyPreview.style.borderRadius = "5px";
        replyPreview.style.padding = "7px 14px";
        replyPreview.style.marginTop = "12px";
        replyPreview.style.marginBottom = "0";
        replyPreview.style.fontSize = "1em";
        replyPreview.style.maxWidth = "98%";
        replyPreview.style.boxShadow = darkModeToggle.checked
          ? "0 2px 12px rgba(30,60,120,0.18)"
          : "0 2px 12px rgba(0,80,200,0.12)";
        replyPreview.style.transition = "all 0.25s cubic-bezier(.4,2,.6,1)";
        const replyPreviewContainer = document.getElementById('reply-preview-container');
        if (replyPreviewContainer) {
          replyPreviewContainer.innerHTML = '';
          replyPreviewContainer.appendChild(replyPreview);
        }
      }
      let previewContent = "";
const fileMatch = originalData.text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<br>([\s\S]+))?$/);      const codeMatch = originalData.text.match(/^```(\w+)?\n?([\s\S]*?)```$/);

      if (fileMatch) {
        let url = fileMatch[1];
        if (deletedFiles.has(fileMatch[2])) {
          url = "#";
        }
        const filename = fileMatch[2];
        const extraText = fileMatch[3] ? fileMatch[3].trim() : "";
        const fileExt = filename.split('.').pop().toLowerCase();
        const isImage = ["jpg","jpeg","png","gif","webp"].includes(fileExt);
        if (isImage) {
          previewContent = `<img src="${url}" alt="${escapeHtml(filename)}" style="max-width:38px;max-height:38px;vertical-align:middle;margin-left:8px;border-radius:5px;">`;
        } else {
          previewContent = `<span style="display:inline-flex;align-items:center;margin-left:8px;">
            <span style="font-size:1.1em;margin-right:4px;">📄</span>
            <span style="color:#888;font-size:0.95em;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;">${escapeHtml(filename.length > 32 ? filename.slice(0, 32) + "..." : filename)}</span>
          </span>`;
        }
        if (extraText) {
          previewContent += `<span style="margin-left:10px;color:${darkModeToggle.checked ? "#eee" : "#444"};font-style:italic;">${escapeHtml(extraText.length > 60 ? extraText.slice(0, 60) + "..." : extraText)}</span>`;
        }
      } else if (codeMatch) {
        const code = codeMatch[2].split('\n')[0]; 
        previewContent = `<span style="display:inline-flex;align-items:center;margin-left:8px;">
          <code class="reply-code-preview" style="background:${darkModeToggle.checked ? "#222" : "#eee"};border-radius:3px;padding:1px 7px;font-size:0.97em;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;color:${darkModeToggle.checked ? "#eee" : "#222"};">${escapeHtml(code.length > 120 ? code.slice(0, 120) + "..." : code)}</code>
        </span>`;
      }

      const replyText = escapeHtml(originalData.text);
      let shortText = replyText.length > 80 ? replyText.slice(0, 80) + "..." : replyText;

      const imgMatch = originalData.text.trim().match(/^<img\s+src="([^"]+)"[^>]*>$/i);
      const urlMatch = originalData.text.trim().match(/^(https?:\/\/[^\s<]+?\.(gif|png|jpe?g|webp|bmp|svg)(\?.*)?)$/i);
      const videoMatch = originalData.text.trim().match(/^(https?:\/\/[^\s<]+?\.mp4(\?.*)?)$/i);

      if (fileMatch || codeMatch || imgMatch || urlMatch || videoMatch) shortText = "";

      if (imgMatch) {
        previewContent = `<img src="${imgMatch[1]}" alt="GIF" style="max-width:38px;max-height:38px;vertical-align:middle;margin-left:8px;border-radius:5px;">`;
      } else if (urlMatch) {
        previewContent = `<img src="${urlMatch[1]}" alt="GIF" style="max-width:38px;max-height:38px;vertical-align:middle;margin-left:8px;border-radius:5px;">`;
      } else if (videoMatch) {
        previewContent = `<span style="display:inline-block;vertical-align:middle;margin-left:8px;">
          <video src="${videoMatch[1]}" style="max-width:38px;max-height:38px;border-radius:5px;vertical-align:middle;" autoplay loop muted playsinline></video>
          <span style="color:#888;font-size:0.95em;">MP4</span>
        </span>`;
      }
      if (fileMatch || codeMatch) shortText = "";

      replyPreview.innerHTML = `
        <span style="font-weight:500;color:#3399ff;">↩ Replying to <span style="color:${userColors[originalData.nick] || '#007bff'}">${escapeHtml(originalData.nick)}</span>:</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${shortText} ${previewContent}</span>
        <span style="flex:0 0 auto; margin-left:auto;">
          <button id="cancel-reply" style="font-size:0.9em;padding:2px 10px;line-height:1.1;border-radius:4px;background:${darkModeToggle.checked ? "#444" : "#eee"};border:1px solid ${darkModeToggle.checked ? "#666" : "#ccc"};color:${darkModeToggle.checked ? "#eee" : "#444"};cursor:pointer;">✖</button>
        </span>
      `;


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
      const startedAt = performance.now();
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
          const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.05);
          const speed = formatTransferRate(loaded / elapsedSeconds);
          if (total) {
            progressDiv.textContent = `${formatBytes(loaded)} / ${formatBytes(total)} downloaded · ${speed}`;
          } else {
            progressDiv.textContent = `${formatBytes(loaded)} downloaded · ${speed}`;
          }
          return read();
        });
      }
      return read();
    })
    .catch(err => {
      progressDiv.textContent = "";
      showError('Download failed! Arcabit blocked downloading. If Arcabit ssie pałe to skopiuj kod custom przeglądarki  <a href="#" id="show-custom-browser-popup" style="color:#3399ff;text-decoration:underline;font-weight:bold;">TUTAJ</a>');
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

settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    settingsModal.style.display = "none";
  }
});

function checkifdeleted(originalData) {
  fetch("/file-list")
    .then(res => res.json())
    .then(serverFiles => {
      const serverFilesSet = new Set(serverFiles);
      if (
        originalData &&
        originalData.text &&
        /^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<br>([\s\S]+))?$/.test(originalData.text)
      ) { 
        const match = originalData.text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<br>([\s\S]+))?$/);
        if (match) {
          const filename = match[2];
          if (!serverFilesSet.has(filename)) {
            deletedFiles.add(filename);
            return true;
          }
        }
      }
    }
  );
}

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
          /^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<br>([\s\S]+))?$/.test(originalData.text)
        ) { 
          const match = originalData.text.match(/^📎 <a href="([^"]+)"[^>]*>([^<]+)<\/a>(?:<br>([\s\S]+))?$/);
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

let imageList = [];
let currentIndex = 0;
let zoomLevel = 1;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let imgOffsetX = 0, imgOffsetY = 0;

window.openImageModal = function(url, filename) {
  const modal = document.getElementById("image-modal");
  const modalImg = document.getElementById("modal-img");
  const modalVideo = document.getElementById("modal-video");

  const mediaNodes = [
    ...document.querySelectorAll(".chat-gif-img, .chat-img-container video, .file-card img")
  ].filter(node => {
    if (node.closest('.file-deleted')) return false;
    if (node.tagName === "IMG") {
      const fname = node.alt || node.dataset.filename || "";
      return !deletedFiles.has(fname);
    }
    return true;
  });

  imageList = mediaNodes.map(node => ({
    src: node.src,
    type: node.tagName === "VIDEO" ? "video" : "img"
  }));

  currentIndex = imageList.findIndex(m => m.src === url);

  if (currentIndex === -1) {
    imageList = [{ src: url, type: /\.mp4(\?.*)?$/i.test(url) ? "video" : "img" }];
    currentIndex = 0;
  }

  showModalMedia(currentIndex);

  modal.style.display = "flex";
  zoomLevel = 1;
  imgOffsetX = imgOffsetY = 0;
  setModalTransform();
};

function showModalMedia(idx) {
  const modalImg = document.getElementById("modal-img");
  const modalVideo = document.getElementById("modal-video");
  const media = imageList[idx];
  if (!media) return;

  if (media.type === "img") {
    modalImg.src = media.src;
    modalImg.style.display = "block";
    modalVideo.pause();
    modalVideo.style.display = "none";
    modalVideo.src = "";
  } else {
    modalVideo.src = media.src;
    modalVideo.style.display = "block";
    modalImg.style.display = "none";
    modalImg.src = "";
    modalVideo.play().catch(() => {});
  }
  zoomLevel = 1;
  imgOffsetX = imgOffsetY = 0;
  setModalTransform();
}

window.closeImageModal = function() {
  const modal = document.getElementById("image-modal");
  const modalImg = document.getElementById("modal-img");
  const modalVideo = document.getElementById("modal-video");
  modal.style.display = "none";
  modalImg.src = "";
  modalVideo.pause();
  modalVideo.src = "";
};

document.getElementById("image-modal").addEventListener("click", (e) => {
  if (e.target.id === "image-modal") {
    closeImageModal();
  }
});

window.navigateImage = function(direction) {
  if (!imageList.length) return;
  currentIndex = (currentIndex + direction + imageList.length) % imageList.length;
  showModalMedia(currentIndex);
};

function setModalTransform() {
  const modalImg = document.getElementById("modal-img");
  const modalVideo = document.getElementById("modal-video");
  if (modalImg.style.display === "block") {
    modalImg.style.transform = `translate(${imgOffsetX}px, ${imgOffsetY}px) scale(${zoomLevel})`;
  }
  if (modalVideo.style.display === "block") {
    modalVideo.style.transform = `translate(${imgOffsetX}px, ${imgOffsetY}px) scale(${zoomLevel})`;
  }
}

["modal-img", "modal-video"].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomLevel += e.deltaY < 0 ? 0.2 : -0.2;
    if (zoomLevel < 1) zoomLevel = 1;
    if (zoomLevel > 5) zoomLevel = 5;
    setModalTransform();
  });
  el.addEventListener("dblclick", (e) => {
    zoomLevel = 1;
    imgOffsetX = imgOffsetY = 0;
    setModalTransform();
  });
  el.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragStartX = e.clientX - imgOffsetX;
    dragStartY = e.clientY - imgOffsetY;
    el.style.cursor = "grabbing";
  });
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  imgOffsetX = e.clientX - dragStartX;
  imgOffsetY = e.clientY - dragStartY;
  setModalTransform();
});

window.addEventListener("mouseup", () => {
  isDragging = false;
  const modalImg = document.getElementById("modal-img");
  const modalVideo = document.getElementById("modal-video");
  if (modalImg.style.display === "block") modalImg.style.cursor = zoomLevel > 1 ? "grab" : "default";
  if (modalVideo.style.display === "block") modalVideo.style.cursor = zoomLevel > 1 ? "grab" : "default";
});

function adjustImageSize(img) {
  const maxWidth = window.innerWidth * 0.8; 
  const maxHeight = 220;                   
  const minWidth = 220;                    

  let width = img.naturalWidth;
  let height = img.naturalHeight;

  if (width > maxWidth) {
    const scale = maxWidth / width;
    width = maxWidth;
    height = height * scale;
  }

  if (height > maxHeight) {
    const scale = maxHeight / height;
    height = maxHeight;
    width = width * scale;
  }

  if (width < minWidth) {
    const scale = minWidth / width;
    width = minWidth;
    height = height * scale;
  }


  img.parentElement.style.width = img.style.width;
  img.parentElement.style.height = img.style.height;

  const fileCard = img.closest('.file-card');
  fileCard.style.width = width + 20 + 'px'; 
}

document.querySelectorAll('.file-card .thumb img').forEach(img => {
  img.onload = () => adjustImageSize(img);
});

const observer = new MutationObserver(mutations => {
  mutations.forEach(m => {
    m.addedNodes.forEach(node => {
      if (node.nodeType === 1) {
        node.querySelectorAll?.('.file-card .thumb img').forEach(img => {
          img.onload = () => adjustImageSize(img);
          if (img.complete) adjustImageSize(img); 
        });
      }
    });
  });
});

observer.observe(document.body, { childList: true, subtree: true });
function safeSend(obj) { if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); } else { ws.addEventListener("open", () => ws.send(JSON.stringify(obj)), { once: true }); } }

document.addEventListener("DOMContentLoaded", () => {
  entryNicknameForm?.addEventListener("submit", event => {
    event.preventDefault();
    joinAsGuest(entryNicknameInput.value);
  });
  entryLoginButton?.addEventListener("click", () => {
    setAuthMode("login");
    openModal();
  });
  entryRegisterButton?.addEventListener("click", () => {
    setAuthMode("register");
    openModal();
  });

  const loginModal = document.getElementById("login-modal");
  const loginBox = document.querySelector(".login-box");
  const closeLogin = document.getElementById("close-login");
  const loginToggleBtn = document.getElementById("login-toggle-btn");
  const loginBtn = document.getElementById("login-btn");
  const registerBtn = document.getElementById("register-btn");
  const accountModal = document.getElementById("account-modal");
  const closeAccountBtn = document.getElementById("close-account-btn");
  const accountSaveSettingsBtn = document.getElementById("account-save-settings-btn");
  const accountChangePasswordBtn = document.getElementById("account-change-password-btn");
  const accountViewSessionsBtn = document.getElementById("account-view-sessions-btn");
  const accountChangePasswordForm = document.getElementById("account-change-password-form");
  const accountSubmitPasswordBtn = document.getElementById("account-submit-password-btn");
  const accountCancelPasswordBtn = document.getElementById("account-cancel-password-btn");
  const accountSessionsFrame = document.getElementById("account-sessions-frame");
  const accountSessionsListDiv = document.getElementById("account-sessions-list");
  const accountCloseSessionsBtn = document.getElementById("account-close-sessions-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const logoutBtnSettings = document.getElementById("logout-btn-settings");
  const logoutAllSessionsBtn = document.getElementById("logout-all-sessions-btn");
  const GIPHY_API_KEY = "5irhUb4BRd1GDHxlFaNUK9FNnXwEmRDG";
  (function setupGifPicker() {
  const picker = document.getElementById("giphy-picker");
  const msgInput = document.getElementById("msg");

  document.addEventListener("click", function(e) {
    if (e.target.classList.contains("chat-gif-fav-btn")) {
      const src = e.target.dataset.gif;
      let favs = userFavorites;
      const isFav = favs.includes(src);
      if (isFav) {
        favs = favs.filter(url => url !== src);
        e.target.classList.remove("fav");
        e.target.textContent = "❤";
        e.target.title = "Add to favorites";
      } else {
        favs.push(src);
        e.target.classList.add("fav");
        e.target.textContent = "★";
        e.target.title = "Remove from favorites";
      }
      userFavorites = favs;
      if (loggedInUser) {
        ws.send(JSON.stringify({
          type: "save-favorites",
          username: loggedInUser,
          favorites: favs
        }));
      }
    }
  });

  const gifBtn = document.getElementById("gif-btn");
  gifBtn.addEventListener("click", () => {
    if (picker.style.display === "block") {
      picker.style.display = "none";
    } else showGifPicker();
  });

  const favKey = "giphy_favorites";
  const getFavs = () => userFavorites;
  function saveFavs(arr) {
    if (loggedInUser) {
      ws.send(JSON.stringify({
        type: "save-favorites",
        username: loggedInUser,
        favorites: arr
      }));
    }
  }
async function showGifPicker() {
  const picker = document.getElementById("giphy-picker");
  picker.style.display = "block";
  picker.innerHTML = `
    <div id="gif-panel" style="
      width:520px;max-width:98vw;
      background:${document.body.classList.contains("dark") ? "#23232b" : "#fff"};
      color:${document.body.classList.contains("dark") ? "#eee" : "#222"};
      border-radius:14px;
      box-shadow:0 8px 32px rgba(0,0,0,.18);
      padding:18px 18px 12px 18px;
      font-family:Segoe UI, Arial, sans-serif;
      transition:background 0.2s;
      position:relative;
      animation:fadeInGifPanel 0.25s;
    ">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <input id="gif-search" placeholder="Search GIFs..." 
          style="flex:1;padding:10px 14px;border:none;border-radius:8px;background:${document.body.classList.contains("dark") ? "#18181c" : "#f7f7f7"};color:${document.body.classList.contains("dark") ? "#ccc" : "#222"};font-size:1.1em;box-shadow:0 1px 4px rgba(0,0,0,0.07);">
        <button id="gif-close" style="background:none;color:${document.body.classList.contains("dark") ? "#bbb" : "#888"};border:none;font-size:22px;cursor:pointer;">✖</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button class="gif-tab active" data-tab="trending">🔥 Trending</button>
        <button class="gif-tab" data-tab="favorites">⭐ Favorites</button>
        <button class="gif-tab" data-tab="search">🔍 Search</button>
      </div>
      <div id="gif-grid" style="display:flex;gap:12px;width:100%;max-height:55vh;overflow:auto;transition:background 0.2s;">
        <div class="gif-col"></div>
        <div class="gif-col"></div>
        <div class="gif-col"></div>
      </div>
    </div>
    <style>
      @keyframes fadeInGifPanel { from { opacity:0; transform:scale(0.97);} to { opacity:1; transform:scale(1);} }
      .gif-tab {
        flex:1;
        background:${document.body.classList.contains("dark") ? "#18181c" : "#f0f0f0"};
        color:${document.body.classList.contains("dark") ? "#ccc" : "#444"};
        border:none;
        padding:7px 0;
        border-radius:8px;
        cursor:pointer;
        font-size:1em;
        font-weight:500;
        transition:.2s;
      }
      .gif-tab:hover { background:${document.body.classList.contains("dark") ? "#383a40" : "#e0e0e0"}; }
      .gif-tab.active { background:#5865f2; color:#fff; }
      .gif-item img, .gif-item video {
        width:100%;
        border-radius:8px;
        display:block;
        box-shadow:0 2px 8px rgba(0,0,0,0.08);
        transition:transform 0.15s;
        margin:0;
        background:#222;
      }
      .gif-item img:hover, .gif-item video:hover { transform:scale(1.06); }
      .gif-item {
        position:relative;
        cursor:pointer;
        overflow:hidden;
        background:${document.body.classList.contains("dark") ? "#23232b" : "#fff"};
        border-radius:8px;
        box-shadow:0 1px 4px rgba(0,0,0,0.07);
        transition:background 0.2s;
        margin:0 0 12px 0 !important;
        padding:0 !important;
        break-inside: avoid;
      }
      .gif-heart {
        position:absolute;
        top:8px; right:8px;
        font-size:20px;
        text-shadow:0 0 5px #000;
        color:#fff;
        opacity:0.7;
        transition:.2s;
        background:rgba(0,0,0,0.18);
        border-radius:50%;
        padding:2px 6px;
      }
      .gif-heart.fav { color:#f04747; opacity:1; background:rgba(255,255,255,0.18);}
      .gif-item:hover .gif-heart { opacity:1; transform:scale(1.2); }
      .gif-col { flex:1 1 0; display:flex; flex-direction:column; gap:0; margin:0; padding:0; }
    </style>
  `;

  document.addEventListener("mousedown", (e) => {
    if (picker && picker.style.display === "block" && !picker.contains(e.target) && e.target.id !== "gif-btn") {
      picker.style.display = "none";
    }
  });
  document.getElementById("gif-close").onclick = () => (picker.style.display = "none");
  document.getElementById("gif-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadGifs("search");
  });
  document.getElementById("gif-search").addEventListener("input", () => {
    loadGifs("search");
  });
  picker.querySelectorAll(".gif-tab").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      picker.querySelectorAll(".gif-tab").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      loadGifs(e.target.dataset.tab);
    })
  );
  loadGifs("trending");

  async function loadGifs(tab) {
    const grid = document.getElementById("gif-grid");
    const cols = grid.querySelectorAll('.gif-col');
    cols.forEach(col => col.innerHTML = "");
    grid.scrollTop = 0;
    let gifs = [];

    if (tab === "favorites") {
      const favs = userFavorites.slice().reverse();
      if (!favs.length) {
        cols[0].innerHTML = "<div style='padding:20px;color:#aaa;'>No favorites yet.</div>";
        return;
      }
      gifs = favs.map((url) => ({ images: { fixed_width: { url } } }));
    } else {
      let url = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=g`;
      if (tab === "search") {
        const q = document.getElementById("gif-search").value.trim();
        if (!q) {
          cols[0].innerHTML = "<div style='padding:20px;color:#aaa;'>Type something to search.</div>";
          return;
        }
        url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=g`;
      }
      try {
        const res = await fetch(url);
        const data = await res.json();
        gifs = data.data || [];
      } catch (e) {
        cols[0].innerHTML = "Failed to load GIFs.";
        return;
      }
    }

    const favs = userFavorites;

    gifs.forEach((gif, i) => {
      let src = gif.images?.fixed_width?.url || gif.video || gif;
      const isVideo = /\.mp4(\?.*)?$/i.test(src);
      const div = document.createElement("div");
      div.className = "gif-item";

      if (isVideo) {
        div.innerHTML = `
          <video src="${src}" autoplay loop muted playsinline
            style="width:100%;border-radius:8px;display:block;cursor:pointer;"></video>
          <span class="gif-heart ${favs.includes(src) ? "fav" : ""}">❤</span>
        `;
      } else {
        div.innerHTML = `
          <img src="${src}" alt=""
            style="width:100%;border-radius:8px;display:block;cursor:pointer;">
          <span class="gif-heart ${favs.includes(src) ? "fav" : ""}">❤</span>
        `;
      }

      div.querySelector(".gif-heart").addEventListener("click", (e) => {
        e.stopPropagation();
        const list = userFavorites.slice();
        const idx = list.indexOf(src);
        if (idx === -1) list.push(src);
        else list.splice(idx, 1);
        if (loggedInUser) {
          ws.send(JSON.stringify({
            type: "save-favorites",
            username: loggedInUser,
            favorites: list
          }));
        }
        userFavorites = list;
        const activeTab = picker.querySelector(".gif-tab.active")?.dataset.tab;
        if (activeTab === "favorites") {
          loadGifs("favorites");
        } else {
          e.target.classList.toggle("fav");
          document.querySelectorAll(`.chat-gif-fav-btn[data-gif="${src}"]`).forEach(btn => {
            if (list.includes(src)) {
              btn.classList.add("fav");
              btn.textContent = "★";
              btn.title = "Remove from favorites";
            } else {
              btn.classList.remove("fav");
              btn.textContent = "❤";
              btn.title = "Add to favorites";
            }
          });
        }
      });

      div.addEventListener("click", async () => {
        if (!src) return;
        const encrypted = await encryptChatMessage(src);
        if (!encrypted) return;
        const payload = { type: "message", nick, ...encrypted };
        if (msg.dataset.replyTo) {
          payload.replyTo = msg.dataset.replyTo;
          msg.dataset.replyTo = "";
          const replyPreview = document.getElementById('reply-preview');
          if (replyPreview) replyPreview.remove();
        }
        ws.send(JSON.stringify(payload));
        picker.style.display = "none";
      });

      cols[i % cols.length].appendChild(div);
    });
  }
}

  async function loadGifs(tab) {
    const grid = document.getElementById("gif-grid");
    grid.innerHTML = "Loading...";
    let gifs = [];

    if (tab === "favorites") {
      const favs = userFavorites;
      if (!favs.length) {
        grid.innerHTML = "<div style='padding:20px;color:#aaa;'>No favorites yet.</div>";
        return;
      }
      gifs = favs.map((url) => ({ images: { fixed_width: { url } } }));
    } else {
      let url = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=g`;
      if (tab === "search") {
        const q = document.getElementById("gif-search").value.trim();
        if (!q) {
          grid.innerHTML = "<div style='padding:20px;color:#aaa;'>Type something to search.</div>";
          return;
        }
        url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(
          q
        )}&limit=24&rating=g`;
      }
      try {
        const res = await fetch(url);
        const data = await res.json();
        gifs = data.data || [];
      } catch (e) {
        grid.innerHTML = "Failed to load GIFs.";
        return;
      }
    }

    grid.innerHTML = "";
    const favs = userFavorites;

    gifs.forEach((gif) => {
      let src = gif.images?.fixed_width?.url || gif.video || gif; 
      const isVideo = /\.mp4(\?.*)?$/i.test(src);
      const div = document.createElement("div");
      div.className = "gif-item";

      if (isVideo) {
        div.innerHTML = `
          <video src="${src}" autoplay loop muted playsinline
            style="width:100%;border-radius:8px;display:block;cursor:pointer;"></video>
          <span class="gif-heart ${favs.includes(src) ? "fav" : ""}">❤</span>
        `;
      } else {
        div.innerHTML = `
          <img src="${src}" alt=""
            style="width:100%;border-radius:8px;display:block;cursor:pointer;">
          <span class="gif-heart ${favs.includes(src) ? "fav" : ""}">❤</span>
        `;
      }

      div.querySelector(".gif-heart").addEventListener("click", (e) => {
        e.stopPropagation();
        const list = getFavs();
        const idx = list.indexOf(src);
        if (idx === -1) list.push(src);
        else list.splice(idx, 1);
        saveFavs(list);
        e.target.classList.toggle("fav");
        document.querySelectorAll(`.chat-gif-fav-btn[data-gif="${src}"]`).forEach(btn => {
          if (list.includes(src)) {
            btn.classList.add("fav");
            btn.textContent = "★";
            btn.title = "Remove from favorites";
          } else {
            btn.classList.remove("fav");
            btn.textContent = "❤";
            btn.title = "Add to favorites";
          }
        });
      });

      div.addEventListener("click", async () => {
        if (!src) return; 
        const isVideo = /\.mp4(\?.*)?$/i.test(src);

        const encrypted = await encryptChatMessage(src);
        if (!encrypted) return;
        const payload = { type: "message", nick, ...encrypted };

        if (msgInput.dataset.replyTo) {
          payload.replyTo = msgInput.dataset.replyTo;
          msgInput.dataset.replyTo = "";
          const replyPreview = document.getElementById('reply-preview');
          if (replyPreview) replyPreview.remove();
        }

        ws.send(JSON.stringify(payload));
        picker.style.display = "none";
      });

      grid.appendChild(div);
    });
  }
})();








  if (logoutAllSessionsBtn) {
    logoutAllSessionsBtn.onclick = () => {
      if (!loggedInUser) return showError("Not logged in");
      ws.send(JSON.stringify({
        type: "logout-all-sessions",
        username: loggedInUser
      }));
    };
  }
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = () => {
      if (!loggedInUser) return showError("Not logged in");
      const settings = {
        autoRecover: toggleAutoRecover.checked,
        gifFeatureEnabled: toggleGifFeature.checked,
        color: customNickColorInput.value,
        darkMode: darkModeToggle.checked,
        showTimestamps: toggleTimestamps.checked,
        showFileLinks: toggleFileLinks.checked,
        showReplyBtn: toggleReplyBtn.checked,
        showImagePreview: toggleImagePreview.checked,
        postFiles: togglePostFiles.checked,
        encryptionFeaturesEnabled: toggleEncryptionFeatures.checked,
        e2eEncryptionEnabled: toggleE2EEncryption.checked,
        e2eEncryptionMode: encryptionModeSelect.value,
        encryptionColorsEnabled: toggleEncryptionColors.checked,
        hideUnreadableEncrypted: toggleHideUnreadableEncrypted.checked
      };
      ws.send(JSON.stringify({
        type: "save-settings",
        username: loggedInUser,
        settings
      }));
      localStorage.setItem("customNickColor", settings.color);
      localStorage.setItem("darkMode", settings.darkMode);
      localStorage.setItem("showTimestamps", settings.showTimestamps);
      localStorage.setItem("showFileLinks", settings.showFileLinks);
      localStorage.setItem("showReplyBtn", settings.showReplyBtn);
      localStorage.setItem("showImagePreview", settings.showImagePreview);
      localStorage.setItem("togglePostFiles", settings.postFiles);
      localStorage.setItem("encryptionFeaturesEnabled", settings.encryptionFeaturesEnabled);
      localStorage.setItem("e2eEncryptionEnabled", settings.e2eEncryptionEnabled);
      localStorage.setItem("e2eEncryptionMode", settings.e2eEncryptionMode);
      localStorage.setItem("encryptionColorsEnabled", settings.encryptionColorsEnabled);
      localStorage.setItem("hideUnreadableEncrypted", settings.hideUnreadableEncrypted);
      showError("Settings saved!");
    };
  }

  if (logoutBtnSettings) {
    logoutBtnSettings.onclick = () => {
      loggedInUser = null;
      localStorage.removeItem("loggedInUser");
      localStorage.removeItem("sessionToken");
      updateLoginUI();
      ws.send(JSON.stringify({ type: "logout" }));
      document.getElementById("account-modal").style.display = "none";
      document.getElementById("account-change-password-form").style.display = "none";
      document.getElementById("account-sessions-frame").style.display = "none";
    };
  }



  document.getElementById("login-toggle-btn").addEventListener("click", () => {
      if (loggedInUser) accountModal.style.display = "flex";
    });

    closeAccountBtn.onclick = () => {
      accountModal.style.display = "none";
      accountChangePasswordForm.style.display = "none";
      accountSessionsFrame.style.display = "none";
    };

    accountSaveSettingsBtn.onclick = () => {
      if (!loggedInUser) return showError("Not logged in");
      const settings = {
        autoRecover: toggleAutoRecover.checked,
        gifFeatureEnabled: toggleGifFeature.checked,
        color: customNickColorInput.value,
        darkMode: darkModeToggle.checked,
        showTimestamps: toggleTimestamps.checked,
        showFileLinks: toggleFileLinks.checked,
        showReplyBtn: toggleReplyBtn.checked,
        showImagePreview: toggleImagePreview.checked,
        postFiles: togglePostFiles.checked
      };
      ws.send(JSON.stringify({
        type: "save-settings",
        username: loggedInUser,
        settings
      }));
      localStorage.setItem("customNickColor", settings.color);
      localStorage.setItem("darkMode", settings.darkMode);
      localStorage.setItem("showTimestamps", settings.showTimestamps);
      localStorage.setItem("showFileLinks", settings.showFileLinks);
      localStorage.setItem("showReplyBtn", settings.showReplyBtn);
      localStorage.setItem("showImagePreview", settings.showImagePreview);
      localStorage.setItem("togglePostFiles", settings.postFiles);
      showError("Settings saved!");
    };

    accountChangePasswordBtn.onclick = () => {
      accountChangePasswordForm.style.display = "block";
    };
    accountCancelPasswordBtn.onclick = () => {
      accountChangePasswordForm.style.display = "none";
    };
    accountSubmitPasswordBtn.onclick = () => {
      const oldPw = document.getElementById("account-old-password").value;
      const newPw = document.getElementById("account-new-password").value;
      if (!oldPw || !newPw) return showError("Fill both fields");
      pendingAccountPassword = newPw;
      ws.send(JSON.stringify({
        type: "change-password",
        username: loggedInUser,
        old_password: oldPw,
        new_password: newPw
      }));
    };

    accountViewSessionsBtn.onclick = () => {
      if (!loggedInUser) return showError("Not logged in");
      ws.send(JSON.stringify({
        type: "get-sessions",
        username: loggedInUser
      }));
      accountSessionsFrame.style.display = "block";
      accountSessionsListDiv.innerHTML = "<em>Loading...</em>";
    };
    accountCloseSessionsBtn.onclick = () => {
      accountSessionsFrame.style.display = "none";
    };

  loginToggleBtn.style.position = "relative";



  loginToggleBtn.addEventListener("click", (e) => {
    if (!loggedInUser) {
      setAuthMode("login");
      openModal();
    }
  });

  document.addEventListener("click", function(e) {
    if (e.target && e.target.id === "show-custom-browser-popup") {
      e.preventDefault();
      document.getElementById("custom-browser-popup").style.display = "flex";
    }
    if (e.target && e.target.id === "close-custom-browser-popup") {
      document.getElementById("custom-browser-popup").style.display = "none";
    }
    if (e.target && e.target.id === "copy-custom-browser-code") {
      const ta = document.getElementById("custom-browser-code");
      ta.select();
      document.execCommand("copy");
      e.target.textContent = "Copied!";
      setTimeout(() => { e.target.textContent = "Copy code"; }, 1200);
    }
  });
  document.getElementById("custom-browser-popup").addEventListener("mousedown", function(e) {
    if (e.target === this) this.style.display = "none";
  });

  let clickStartedInside = false;
  loginModal.addEventListener("mousedown", (e) => {
    clickStartedInside = loginBox.contains(e.target);
  });
  loginModal.addEventListener("mouseup", (e) => {
    if (!loginBox.contains(e.target) && !clickStartedInside) {
      closeModal();
    }
  });
  closeLogin.addEventListener("click", closeModal);

  document.getElementById("auth-password-toggle")?.addEventListener("click", () => {
    const passwordInput = document.getElementById("login-password");
    const showPassword = passwordInput.type === "password";
    passwordInput.type = showPassword ? "text" : "password";
    const toggle = document.getElementById("auth-password-toggle");
    toggle.textContent = showPassword ? "◉" : "👁";
    toggle.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
  });

  loginBtn.addEventListener("click", () => {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    accountPassword = password;
    safeSend({ type: authMode === "login" ? "login" : "register", username, password });
  });
  registerBtn.addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "register" : "login");
  });

  updateLoginUI();
});

function openModal() {
  const loginModal = document.getElementById("login-modal");
  loginModal.style.display = "flex";
}

function closeModal() {
  const loginModal = document.getElementById("login-modal");
  const loginBox = document.querySelector(".login-box");
  loginModal.style.animation = "fadeOutOverlay 0.25s ease forwards";
  loginBox.style.animation = "slideUpFade 0.25s ease forwards";
  setTimeout(() => {
    loginModal.style.display = "none";
    loginModal.style.animation = "";
    loginBox.style.animation = "";
  }, 250);
}
function updateLoginUI() {
    const loginToggleBtn = document.getElementById("login-toggle-btn");
    const logoutDropdown = loginToggleBtn.parentNode.querySelector("div");
    if (loggedInUser) {
        loginToggleBtn.textContent = loggedInUser + " ⬇️";
    } else {
        loginToggleBtn.textContent = "🔑 Log in";
        if (logoutDropdown) logoutDropdown.style.display = "none";
    }
}
document.getElementById("account-modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("account-modal")) {
    document.getElementById("account-modal").style.display = "none";
    document.getElementById("account-change-password-form").style.display = "none";
    document.getElementById("account-sessions-frame").style.display = "none";
  }
});




toggleFileLinks.addEventListener("change", adjustMainChatWidth);
window.addEventListener("resize", adjustMainChatWidth);

adjustMainChatWidth();
window.onload = adjustMainChatWidth;
