(() => {
  if (window.hasRunSpotifyExtension) return;
  window.hasRunSpotifyExtension = true;

  console.log("Spotify extension loaded");

  window.CONFIG = window.CONFIG || {
    CLIENT_ID: null,
    SPOTIFY_URL: "https://api.spotify.com/v1/search?q=",
    REDIRECT_URI: `chrome-extension://${chrome.runtime.id}/callback.html`
  };

  let observer = null;
  let isMonitoring = false;
  let lastTrackInfo = { artist: null, track: null }; // Track the last known song to avoid unnecessary updates

  async function getClientIdFromBackground() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_CLIENT_ID" }, (response) => {
        resolve(response?.CLIENT_ID || null);
      });
    });
  }

  async function getRefreshTokenFromBackground() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_REFRESH_TOKEN" }, (response) => {
        resolve(response?.spotify_refresh_token || null);
      });
    });
  }

  async function storeRefreshToken(refreshToken) {
    chrome.runtime.sendMessage({ type: "STORE_REFRESH_TOKEN", refreshToken });
  }

  async function initializeConfig() {
    CONFIG.CLIENT_ID = await getClientIdFromBackground();
    console.log("Client ID initialized:", CONFIG.CLIENT_ID);
  }

  const generateRandomString = (length) => {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
  };

  const sha256 = async (plain) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest('SHA-256', data);
  };

  const base64encode = (input) => {
    return btoa(String.fromCharCode(...new Uint8Array(input)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  };

  // Use chrome.storage instead of localStorage for extension compatibility
  async function getStoredToken() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_ACCESS_TOKEN" }, (response) => {
        resolve(response?.access_token || null);
      });
    });
  }

  function storeToken(token) {
    chrome.runtime.sendMessage({ type: "STORE_TOKENS", accessToken: token });
  }

  async function isTokenValid() {
    const token = await getStoredToken();
    if (!token) return false;

    try {
      const res = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function refreshAccessToken() {
    const refreshToken = await getRefreshTokenFromBackground();
    if (!refreshToken) return null;

    await initializeConfig();

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CONFIG.CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    });

    if (!res.ok) return null;

    const data = await res.json();
    storeToken(data.access_token);
    return data.access_token;
  }

  async function redirectToSpotify() {
    await initializeConfig();
    const verifier = generateRandomString(64);

    // Store verifier via background script
    chrome.runtime.sendMessage({ type: "STORE_CODE_VERIFIER", codeVerifier: verifier });

    const challenge = base64encode(await sha256(verifier));

    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CONFIG.CLIENT_ID);
    url.searchParams.set("scope", "user-read-private user-read-email");
    url.searchParams.set("redirect_uri", CONFIG.REDIRECT_URI);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);

    // Open in new tab instead of redirecting current tab
    chrome.runtime.sendMessage({ type: "OPEN_AUTH_TAB", url: url.toString() });
  }

  async function codeForToken(code) {
    await initializeConfig();

    // Get verifier from background script
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_CODE_VERIFIER" }, resolve);
    });
    const verifier = response?.codeVerifier;

    if (!verifier) {
      console.error("No code verifier found");
      return;
    }

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CONFIG.CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: CONFIG.REDIRECT_URI,
        code_verifier: verifier
      })
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    // Store tokens via background script
    chrome.runtime.sendMessage({
      type: "STORE_TOKENS",
      accessToken: data.access_token,
      refreshToken: data.refresh_token
    });

    if (data.refresh_token) {
      await storeRefreshToken(data.refresh_token);
    }

    console.log("Tokens stored successfully");

    // Immediately start monitoring without delay
    startMonitoring();
  }

  function removeBracketTextFromTitle(track) {
    return track.replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, '').trim();
  }

  const DOMutils = {
    getArtistName() {
      // Try multiple selectors for artist
      const selectors = [
        "ytmusic-player-bar yt-formatted-string.byline a",
        ".ytmusic-player-bar .subtitle a",
        ".byline.ytmusic-player-bar a"
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          console.log("Found artist:", element.textContent.trim());
          return element.textContent.trim();
        }
      }
      console.log("Artist not found");
      return null;
    },
    getSongName() {
      // Try multiple selectors for song title
      const selectors = [
        "yt-formatted-string.title.style-scope.ytmusic-player-bar",
        ".title.ytmusic-player-bar",
        "ytmusic-player-bar .title"
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          console.log("Found song:", element.textContent.trim());
          return element.textContent.trim();
        }
      }
      console.log("Song title not found");
      return null;
    },
    // Helper to check if video is currently playing
    isVideoPlaying() {
      const videoElement = document.querySelector('video');
      return videoElement && !videoElement.paused;
    },
    // Helper to get current playback time
    getCurrentTime() {
      const videoElement = document.querySelector('video');
      return videoElement ? videoElement.currentTime : 0;
    }
  };

  async function fetchAlbumImage(artist, track) {
    console.log("Fetching album image via background script for:", artist, "-", track);

    // Send a message to the background script to fetch the image
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: "FETCH_ALBUM_IMAGE",
        artist: artist,
        track: track
      }, (response) => {
        if (response && response.imageUrl) {
          console.log("Album image URL received:", response.imageUrl);
          resolve(response.imageUrl);
        } else {
          console.log("Failed to get album image from background script.");
          resolve(null);
        }
      });
    });
  }

  function appendAlbumImage(albumImage) {
    const originalElement = document.getElementById("album-image")
    if (originalElement) {
      if (originalElement.src !== albumImage) {
        originalElement.src = albumImage;
      }
      return;
    }
    const imgElement = document.createElement("img");
    imgElement.id = "album-image";
    imgElement.alt = "Album Image";
    imgElement.src = albumImage;
    const parentElement = document.getElementById("player");
    if (parentElement) {
      const parentStyles = window.getComputedStyle(parentElement);
      imgElement.style.width = parentStyles.width;
      imgElement.style.height = "auto";
      parentElement.appendChild(imgElement);
      console.log("Image appended to the DOM");
    } else {
      console.warn("Parent element not found");
    }
  }

  const hideVideoPlaying = () => {
    console.log("Remove video");
    const elem = document.getElementById("song-video");
    if (elem && elem.parentNode) {
      return elem.parentNode.removeChild(elem);
    } else {
      console.warn(`Element with ID 'song-video' not found`);
      return null;
    }
  };

  function removeAlbumImage() {
    const originalElement = document.getElementById("album-image");
    if (originalElement && originalElement.parentNode) {
      originalElement.parentNode.removeChild(originalElement);
      console.log("Album image removed");
    }
  }

  async function updateTrackInfo() {
    console.log("Updating track info...");

    // Check if this is a video (has the video toggle)
    const hasVideo = document.querySelector("ytmusic-av-toggle[selected-item-has-video]");
    console.log("Has video:", hasVideo ? "Yes" : "No");

    if (!hasVideo) {
      removeAlbumImage();
      return;
    }

    const artist = DOMutils.getArtistName();
    const rawTrack = DOMutils.getSongName();
    const cleanTrack = rawTrack ? removeBracketTextFromTitle(rawTrack) : null;

    console.log("Track info - Artist:", artist, "Track:", cleanTrack);

    // Check if this is the same track as before to avoid unnecessary API calls
    if (artist === lastTrackInfo.artist && cleanTrack === lastTrackInfo.track) {
      console.log("Same track as before, skipping update");
      return;
    }

    // Update last track info
    lastTrackInfo = { artist, track: cleanTrack };

    if (artist && cleanTrack) {
      const albumImage = await fetchAlbumImage(artist, cleanTrack);
      if (albumImage) {
        appendAlbumImage(albumImage);
        hideVideoPlaying();
      } else {
        removeAlbumImage();
      }
    } else {
      console.log("Missing track info, cannot fetch album art");
      removeAlbumImage();
    }
  }

  function startMonitoring() {
    if (isMonitoring) {
      console.log("Already monitoring, skipping...");
      return;
    }

    console.log("Starting track monitoring...");
    isMonitoring = true;

    // Stop any existing observer
    if (observer) {
      observer.disconnect();
    }

    const setupObserver = () => {
      const player = document.querySelector("ytmusic-player-bar");
      if (!player) {
        console.log("Player bar not found, retrying in 1 second...");
        setTimeout(setupObserver, 1000);
        return;
      }

      observer = new MutationObserver((mutations) => {
        // Only process mutations that might indicate a track change
        const hasRelevantChange = mutations.some(mutation => {
          // Check for text content changes in title or byline elements
          if (mutation.type === 'childList') {
            const target = mutation.target;
            return target.matches && (
              target.matches('.title') ||
              target.matches('.byline') ||
              target.closest('.title') ||
              target.closest('.byline') ||
              target.querySelector('.title') ||
              target.querySelector('.byline')
            );
          }
          return false;
        });

        if (hasRelevantChange) {
          console.log("Relevant track change detected");
          // Use shorter delay for faster response
          setTimeout(updateTrackInfo, 300);
        }
      });

      observer.observe(player, { 
        childList: true, 
        subtree: true,
        attributes: true,
        attributeFilter: ['title', 'aria-label']
      });
      
      console.log("Observer set up successfully");

      // Check immediately for current track
      updateTrackInfo();
    };

    setupObserver();
  }

  function stopMonitoring() {
    console.log("Stopping track monitoring...");
    isMonitoring = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("Content script received message:", msg);

    if (msg.action === "process_auth_code") {
      codeForToken(msg.code).then(() => {
        console.log("Token retrieved and stored.");
        sendResponse({ success: true });
      }).catch((error) => {
        console.error("Error processing auth code:", error);
        sendResponse({ success: false, error: error.message });
      });
      return true; // Keep message channel open
    }

    if (msg.action === "manual_auth_trigger") {
      console.log("Manual authorization triggered.");
      redirectToSpotify();
      sendResponse({ success: true });
      return true;
    }

    if (msg.action === "authorizationComplete") {
      console.log("Authorization completed, starting track monitoring immediately...");
      // Start monitoring immediately without delay
      startMonitoring();
      sendResponse({ success: true });
      return true;
    }
  });

  // Initialize
  initializeConfig().then(async () => {
    console.log("Config initialized");

    // Check if we already have a token
    const token = await getStoredToken();
    if (token && await isTokenValid()) {
      console.log("Valid token found, starting monitoring...");
      // Reduced delay for faster startup
      setTimeout(() => {
        startMonitoring();
      }, 1000);
    } else {
      console.log("No valid token found, waiting for authorization...");
    }
  });

  // Listen for page navigation to restart monitoring if needed
  window.addEventListener('beforeunload', () => {
    stopMonitoring();
  });

  // Handle tab visibility changes to restart monitoring when tab becomes active
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isMonitoring) {
      console.log("Tab became active, checking track info...");
      setTimeout(updateTrackInfo, 500);
    }
  });

})();