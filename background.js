const DEFAULT_SETTINGS = {
  enableRoundNavigator: true,
  autoRefreshOnRouteChange: true
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({
    ...DEFAULT_SETTINGS,
    ...current
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "compass:get-default-settings") {
    sendResponse(DEFAULT_SETTINGS);
  }
  if (message?.type === "compass:get-tab-id") {
    sendResponse({ tabId: sender.tab?.id ?? null });
  }
});
