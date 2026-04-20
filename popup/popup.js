const DEFAULT_SETTINGS = {
  enableRoundNavigator: true
};

const els = {
  title: document.getElementById("conversation-title"),
  rounds: document.getElementById("round-count"),
  messages: document.getElementById("message-count"),
  status: document.getElementById("status"),
  enableRoundNavigator: document.getElementById("enable-round-navigator")
};

async function getActiveChatTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  });
  return tab || null;
}

async function sendToActiveTab(type) {
  const tab = await getActiveChatTab();
  if (!tab?.id) {
    throw new Error("Open an active ChatGPT conversation first.");
  }
  return chrome.tabs.sendMessage(tab.id, { type });
}

function setStatus(text) {
  els.status.textContent = text;
}

async function refreshStats() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  els.enableRoundNavigator.checked = Boolean(settings.enableRoundNavigator);

  try {
    const result = await sendToActiveTab("compass:get-stats");
    if (!result?.ok) {
      throw new Error("Extension content script is not ready yet.");
    }
    els.title.textContent = result.title;
    els.rounds.textContent = String(result.rounds);
    els.messages.textContent = String(result.messages);
    setStatus("Ready on the current ChatGPT tab.");
  } catch (error) {
    els.title.textContent = "No active conversation";
    els.rounds.textContent = "-";
    els.messages.textContent = "-";
    setStatus(String(error.message || error));
  }
}

async function updateSetting(key, value) {
  await chrome.storage.sync.set({ [key]: value });
  setStatus("Settings synced to your browser account.");
}

els.enableRoundNavigator.addEventListener("change", (event) => {
  updateSetting("enableRoundNavigator", event.target.checked);
});

refreshStats();
