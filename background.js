// Shows the PR's open review-comment count on the toolbar icon.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'count' || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#8957e5' });
  chrome.action.setBadgeText({ tabId, text: msg.count > 0 ? String(msg.count) : '' });
});
