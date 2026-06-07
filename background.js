chrome.runtime.onInstalled.addListener(() => {
  const CLIENT_ID = "a0aeb4810add4986905a6a9327ff994c";
  chrome.storage.local.set({ CLIENT_ID }, () => {
    console.log("Stored CLIENT_ID");
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const shouldInject = tab.url.includes("music.youtube.com") || 
                        tab.url.includes("www.youtube.com") || 
                        tab.url.includes("youtube.com");
    
    if (shouldInject) {
      console.log("Injecting content script into:", tab.url);
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      }).catch((error) => {
        console.log("Content script injection error:", error.message);
      });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  // Handle authorization complete message from callback
  if (message.type === "AUTHORIZATION_COMPLETE") {
    console.log("Authorization completed, notifying content scripts...");
    
    // FIX: Store tokens under BOTH keys for consistency
    const storageUpdate = {};
    if (message.accessToken) {
      storageUpdate.access_token = message.accessToken;
    }
    if (message.refreshToken) {
      storageUpdate.refresh_token = message.refreshToken;
      storageUpdate.spotify_refresh_token = message.refreshToken;
    }
    
    chrome.storage.local.set(storageUpdate, () => {
      console.log("Tokens stored from AUTHORIZATION_COMPLETE");
    });
    
    const urlPatterns = [
      "https://music.youtube.com/*",
      "https://www.youtube.com/*",
      "https://youtube.com/*"
    ];
    
    urlPatterns.forEach(pattern => {
      chrome.tabs.query({ url: pattern }, (tabs) => {
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
    });
    
    sendResponse({ success: true });
    return true;
  }

  // Handle fetching album images
  if (message.type === "FETCH_ALBUM_IMAGE") {
    const artist = message.artist;
    const track = message.track;

    async function performApiFetch() {
      const { access_token } = await chrome.storage.local.get(["access_token"]);

      if (!access_token) {
        console.error("No access token available to fetch album image.");
        sendResponse({ imageUrl: null });
        return;
      }

      // FIX: First try exact match, then fall back to looser query
      const exactQuery = encodeURIComponent(`track:"${track}" artist:"${artist}"`);
      const exactUrl = `https://api.spotify.com/v1/search?q=${exactQuery}&type=track&limit=1`;

      try {
        console.log("Searching Spotify for:", artist, "-", track);
        let res = await fetch(exactUrl, {
          headers: { Authorization: `Bearer ${access_token}` }
        });

        if (res.status === 401) {
          console.log("Token expired during album fetch, attempting refresh...");
          // Try to refresh the token
          const { spotify_refresh_token, refresh_token, CLIENT_ID } = await chrome.storage.local.get(["spotify_refresh_token", "refresh_token", "CLIENT_ID"]);
          const refreshToken = spotify_refresh_token || refresh_token;
          
          if (refreshToken && CLIENT_ID) {
            const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: CLIENT_ID,
                grant_type: "refresh_token",
                refresh_token: refreshToken
              })
            });
            
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              const newStorageUpdate = { access_token: refreshData.access_token };
              if (refreshData.refresh_token) {
                newStorageUpdate.refresh_token = refreshData.refresh_token;
                newStorageUpdate.spotify_refresh_token = refreshData.refresh_token;
              }
              await chrome.storage.local.set(newStorageUpdate);
              
              // Retry with new token
              res = await fetch(exactUrl, {
                headers: { Authorization: `Bearer ${refreshData.access_token}` }
              });
            } else {
              console.error("Token refresh failed during album fetch");
              sendResponse({ imageUrl: null });
              return;
            }
          } else {
            sendResponse({ imageUrl: null });
            return;
          }
        }

        if (!res.ok) {
          console.error("Spotify API error:", res.status, res.statusText);
          sendResponse({ imageUrl: null });
          return;
        }

        let data = await res.json();
        let imageUrl = data?.tracks?.items?.[0]?.album?.images?.[0]?.url || null;
        
        // FIX: If exact match fails, try a looser search
        if (!imageUrl) {
          console.log("Exact match failed, trying loose search...");
          const looseQuery = encodeURIComponent(`${artist} ${track}`);
          const looseUrl = `https://api.spotify.com/v1/search?q=${looseQuery}&type=track&limit=3`;
          
          const { access_token: currentToken } = await chrome.storage.local.get(["access_token"]);
          const looseRes = await fetch(looseUrl, {
            headers: { Authorization: `Bearer ${currentToken}` }
          });
          
          if (looseRes.ok) {
            const looseData = await looseRes.json();
            imageUrl = looseData?.tracks?.items?.[0]?.album?.images?.[0]?.url || null;
            console.log("Loose search result:", imageUrl ? "Found" : "Not found");
          }
        }
        
        console.log("Album image URL:", imageUrl);
        sendResponse({ imageUrl: imageUrl });
      } catch (error) {
        console.error("Error fetching from Spotify in background:", error);
        sendResponse({ imageUrl: null });
      }
    }

    performApiFetch();
    return true;
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

  // FIX: Store tokens under BOTH keys for consistency
  if (message.type === "STORE_TOKENS") {
    const storageUpdate = {};
    if (message.accessToken) {
      storageUpdate.access_token = message.accessToken;
    }
    if (message.refreshToken) {
      storageUpdate.refresh_token = message.refreshToken;
      storageUpdate.spotify_refresh_token = message.refreshToken;
    }
    
    chrome.storage.local.set(storageUpdate, () => {
      console.log("Tokens stored successfully (both keys)");
      sendResponse({ success: true });
    });
    return true;
  }

  // Forward Spotify auth code to content scripts
  if (message.type === "SPOTIFY_CODE") {
    const urlPatterns = [
      "*://music.youtube.com/*",
      "*://www.youtube.com/*",
      "*://youtube.com/*"
    ];
    
    let messageSent = false;
    
    urlPatterns.forEach(pattern => {
      chrome.tabs.query({ url: pattern }, (tabs) => {
        if (tabs.length > 0 && !messageSent) {
          messageSent = true;
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "process_auth_code",
            code: message.code
          }).catch((error) => {
            console.error("Error sending auth code to content script:", error);
          });
        }
      });
    });
    return;
  }

  if (message.type === "GET_ACCESS_TOKEN") {
    chrome.storage.local.get(["access_token"], (res) => {
      sendResponse({ access_token: res.access_token });
    });
    return true;
  }

  if (message.type === "GET_CLIENT_ID") {
    chrome.storage.local.get(["CLIENT_ID"], (res) => {
      sendResponse({ CLIENT_ID: res.CLIENT_ID });
    });
    return true;
  }

  if (message.type === "GET_REFRESH_TOKEN") {
    // FIX: Check both keys
    chrome.storage.local.get(["spotify_refresh_token", "refresh_token"], (res) => {
      sendResponse({ spotify_refresh_token: res.spotify_refresh_token || res.refresh_token });
    });
    return true;
  }

  if (message.type === "STORE_REFRESH_TOKEN" && message.refreshToken) {
    // FIX: Store under both keys
    chrome.storage.local.set({ 
      spotify_refresh_token: message.refreshToken,
      refresh_token: message.refreshToken 
    }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "VALIDATE_TOKEN") {
    async function validateToken() {
      try {
        const response = await fetch('https://api.spotify.com/v1/me', {
          headers: {
            'Authorization': `Bearer ${message.accessToken}`
          }
        });

        sendResponse({ isValid: response.ok });
      } catch (error) {
        console.error('Token validation error in background:', error);
        sendResponse({ isValid: false });
      }
    }
    validateToken();
    return true;
  }
});