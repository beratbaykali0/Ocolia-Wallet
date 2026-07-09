chrome.runtime.onInstalled.addListener(() => {
  console.log('Ocolia Wallet installed');
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STORAGE') {
    chrome.storage.local.get(message.keys, (result) => {
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'SET_STORAGE') {
    chrome.storage.local.set(message.data, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'REMOVE_STORAGE') {
    chrome.storage.local.remove(message.keys, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
