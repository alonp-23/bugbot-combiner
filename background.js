// Shows the PR's open review-comment count on the toolbar icon.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'count' || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#8957e5' });
  chrome.action.setBadgeText({ tabId, text: msg.count > 0 ? String(msg.count) : '' });
});

// After an update, refresh open PR tabs so they get the new content script.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'update') return;
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*/pull/*' });
  tabs.forEach((tab) => chrome.tabs.reload(tab.id));
});
