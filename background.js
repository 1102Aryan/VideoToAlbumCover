chrome.runtime.onInstalled.addListener(() => {
  const CLIENT_ID = "a0aeb4810add4986905a6a9327ff994c";
  chrome.storage.local.set({ CLIENT_ID }, () => {
    console.log("Stored CLIENT_ID");
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes("music.youtube.com")) {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    }).catch((error) => {
      console.log("Content script injection:", error.message);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  // Handle authorization complete message from callback
  if (message.type === "AUTHORIZATION_COMPLETE") {
    console.log("Authorization completed, notifying content scripts...");
    
    // Store tokens
    if (message.accessToken) {
      chrome.storage.local.set({ access_token: message.accessToken });
    }
    if (message.refreshToken) {
      chrome.storage.local.set({ refresh_token: message.refreshToken });
    }
    
    // Send message to all YouTube Music tabs immediately
    chrome.tabs.query({ url: "https://music.youtube.com/*" }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          action: "authorizationComplete" 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("Tab not ready for message:", chrome.runtime.lastError.message);
          } else {
            console.log("Authorization message sent to tab:", tab.id);
          }
        });
      });
    });
    
    sendResponse({ success: true });
    return true;
  }

  // Handle fetching album images
  if (message.type === "FETCH_ALBUM_IMAGE") {
    const artist = message.artist;
    const track = message.track;

    async function performApiFetch() {
      // Get the token from storage
      const { access_token } = await chrome.storage.local.get(["access_token"]);

      if (!access_token) {
        console.error("No access token available to fetch album image.");
        sendResponse({ imageUrl: null });
        return;
      }

      const q = encodeURIComponent(`track:"${track}" artist:"${artist}"`);
      const url = `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`;

      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${access_token}` }
        });

        if (!res.ok) {
          console.error("Spotify API error from background script:", res.status, res.statusText);
          sendResponse({ imageUrl: null });
          return;
        }

        const data = await res.json();
        const imageUrl = data?.tracks?.items?.[0]?.album?.images?.[0]?.url || null;
        sendResponse({ imageUrl: imageUrl });
      } catch (error) {
        console.error("Error fetching from Spotify in background:", error);
        sendResponse({ imageUrl: null });
      }
    }

    performApiFetch();
    return true; // Keep message channel open for async response
  }

  // Handle opening auth tab
  if (message.type === "OPEN_AUTH_TAB") {
    chrome.tabs.create({ url: message.url });
    return;
  }

  // Handle code verifier storage
  if (message.type === "STORE_CODE_VERIFIER") {
    chrome.storage.local.set({ code_verifier: message.codeVerifier }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "GET_CODE_VERIFIER") {
    chrome.storage.local.get(["code_verifier"], (res) => {
      sendResponse({ codeVerifier: res.code_verifier });
    });
    return true;
  }

  // Handle token storage
  if (message.type === "STORE_TOKENS") {
    chrome.storage.local.set({
      access_token: message.accessToken,
      refresh_token: message.refreshToken
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "SPOTIFY_CODE") {
    // Forward Spotify auth code to content script
    chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "process_auth_code",
          code: message.code
        }).catch((error) => {
          console.error("Error sending auth code to content script:", error);
        });
      }
    });
    return;
  }

  if (message.type === "GET_ACCESS_TOKEN") {
    chrome.storage.local.get(["access_token"], (res) => {
      sendResponse({ access_token: res.access_token });
    });
    return true;
  }

  // Handle storage access for content.js
  if (message.type === "GET_CLIENT_ID") {
    chrome.storage.local.get(["CLIENT_ID"], (res) => {
      sendResponse({ CLIENT_ID: res.CLIENT_ID });
    });
    return true;
  }

  if (message.type === "GET_REFRESH_TOKEN") {
    chrome.storage.local.get(["spotify_refresh_token"], (res) => {
      sendResponse({ spotify_refresh_token: res.spotify_refresh_token });
    });
    return true;
  }

  if (message.type === "STORE_REFRESH_TOKEN" && message.refreshToken) {
    chrome.storage.local.set({ spotify_refresh_token: message.refreshToken }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});