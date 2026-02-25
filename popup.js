// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const authBtn = document.getElementById('auth-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const buttonText = document.getElementById('button-text');
  const settingsToggle = document.getElementById('settings-toggle');
  const platformSelect = document.getElementById('platform-select');
  const dropdown = document.getElementById('settings-dropdown');

  // Load saved platform preference
  await loadPlatformPreference();

  // Initialize dropdown as hidden
  if (dropdown) {
    dropdown.classList.add('hidden');
    dropdown.style.display = 'none';
  }

  // Settings toggle handler
  if (settingsToggle) {
    settingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (dropdown) {
        if (dropdown.classList.contains('hidden')) {
          dropdown.classList.remove('hidden');
          dropdown.style.display = 'block';
        } else {
          dropdown.classList.add('hidden');
          dropdown.style.display = 'none';
        }
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!dropdown?.contains(e.target) && !settingsToggle?.contains(e.target)) {
      if (dropdown) {
        dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
      }
    }
  });

  // Close dropdown when pressing Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dropdown) {
      dropdown.classList.add('hidden');
      dropdown.style.display = 'none';
    }
  });

  // Platform preference change handler
  if (platformSelect) {
    platformSelect.addEventListener('change', async () => {
      const selectedPlatform = platformSelect.value;
      await chrome.storage.local.set({ preferred_platform: selectedPlatform });
      console.log('Platform preference saved:', selectedPlatform);
    });
  }

  // Function to show checking/loading state
  function showCheckingState() {
    if (statusIndicator) {
      statusIndicator.classList.remove('connected', 'disconnected');
      statusIndicator.classList.add('checking');
    }
    if (statusText) {
      statusText.textContent = 'Checking connection...';
    }
    if (authBtn) authBtn.classList.add('hidden');
    if (disconnectBtn) disconnectBtn.classList.add('hidden');
  }

  // Function to show connected state
  function showConnectedState() {
    if (statusIndicator) {
      statusIndicator.classList.remove('disconnected', 'checking');
      statusIndicator.classList.add('connected');
    }
    if (statusText) {
      statusText.textContent = 'Connected to Spotify';
    }
    if (authBtn) authBtn.classList.add('hidden');
    if (disconnectBtn) disconnectBtn.classList.remove('hidden');
    if (authBtn) {
      authBtn.classList.remove('loading');
      authBtn.disabled = false;
    }
  }

  // Function to show not connected state
  function showNotConnectedState() {
    if (statusIndicator) {
      statusIndicator.classList.remove('connected', 'checking');
      statusIndicator.classList.add('disconnected');
    }
    if (statusText) {
      statusText.textContent = 'Not Connected';
    }
    if (authBtn) authBtn.classList.remove('hidden');
    if (disconnectBtn) disconnectBtn.classList.add('hidden');
    if (buttonText) buttonText.textContent = 'Connect to Spotify';
    if (authBtn) {
      authBtn.classList.remove('loading');
      authBtn.disabled = false;
    }
  }

  // Function to notify content scripts of disconnect
  async function notifyContentScriptsDisconnected() {
    console.log("Notifying content scripts of disconnect...");

    const urlPatterns = [
      "https://music.youtube.com/*",
      "https://www.youtube.com/*",
      "https://youtube.com/*"
    ];

    const notifyPromises = [];

    urlPatterns.forEach(pattern => {
      const promise = new Promise((resolve) => {
        chrome.tabs.query({ url: pattern }, (tabs) => {
          const tabPromises = tabs.map(tab => {
            return new Promise((tabResolve) => {
              chrome.tabs.sendMessage(tab.id, {
                action: "extensionDisconnected"
              }, (response) => {
                if (chrome.runtime.lastError) {
                  console.log("Tab not ready for disconnect message:", chrome.runtime.lastError.message);
                }
                tabResolve();
              });
            });
          });

          Promise.all(tabPromises).then(resolve);
        });
      });

      notifyPromises.push(promise);
    });

    await Promise.all(notifyPromises);
  }

  // FIX: Validate token DIRECTLY with Spotify API instead of via background message passing.
  // The old approach sent a message to the background script, which added failure points
  // (message passing timeouts, background script not ready, etc.) that could cause
  // false positives or false negatives.
  async function validateSpotifyToken(accessToken) {
    if (!accessToken) {
      console.log('No access token provided for validation');
      return false;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log('Token validation response status:', response.status);
      return response.ok;
    } catch (error) {
      console.error('Token validation error:', error);
      return false;
    }
  }

  // Try to refresh the access token using refresh token
  async function refreshAccessToken() {
    try {
      // FIX: Consolidate refresh token lookup — check both keys but prefer spotify_refresh_token
      const { spotify_refresh_token, refresh_token } = await chrome.storage.local.get(['spotify_refresh_token', 'refresh_token']);
      const refreshToken = spotify_refresh_token || refresh_token;

      if (!refreshToken) {
        console.log('No refresh token available');
        return false;
      }

      const clientId = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "GET_CLIENT_ID" }, (response) => {
          resolve(response?.CLIENT_ID || null);
        });
      });

      if (!clientId) {
        console.error('No client ID available');
        return false;
      }

      console.log('Attempting to refresh access token...');

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Token refresh successful');

        // FIX: Store under BOTH keys to keep everything in sync
        const storageUpdate = {
          access_token: data.access_token
        };

        if (data.refresh_token) {
          storageUpdate.spotify_refresh_token = data.refresh_token;
          storageUpdate.refresh_token = data.refresh_token;
        }

        await chrome.storage.local.set(storageUpdate);
        return true;
      } else {
        const errorText = await response.text();
        console.error('Token refresh failed:', response.status, errorText);
        return false;
      }

    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  }

  // FIX: Add a lock to prevent concurrent updateConnectionStatus calls
  let isUpdatingStatus = false;

  // Update connection status
  async function updateConnectionStatus() {
    // Prevent concurrent status checks from racing
    if (isUpdatingStatus) {
      console.log('Status check already in progress, skipping');
      return;
    }
    isUpdatingStatus = true;

    try {
      const { access_token, spotify_refresh_token, refresh_token } = await chrome.storage.local.get(['access_token', 'spotify_refresh_token', 'refresh_token']);

      if (!access_token && !spotify_refresh_token && !refresh_token) {
        console.log('No tokens found, not connected');
        showNotConnectedState();
        return;
      }

      showCheckingState();

      if (access_token) {
        const isValid = await validateSpotifyToken(access_token);

        if (isValid) {
          console.log('Access token is valid');
          showConnectedState();
          return;
        } else {
          console.log('Access token is invalid or expired');
        }
      }

      // Access token missing or invalid — try refresh
      if (spotify_refresh_token || refresh_token) {
        console.log('Attempting to refresh token...');
        const refreshSuccess = await refreshAccessToken();

        if (refreshSuccess) {
          // FIX: After refresh, VALIDATE the new token to make sure it actually works
          const { access_token: newToken } = await chrome.storage.local.get(['access_token']);
          const isNewTokenValid = await validateSpotifyToken(newToken);

          if (isNewTokenValid) {
            console.log('Refreshed token is valid');
            showConnectedState();
          } else {
            console.log('Refreshed token failed validation, clearing tokens');
            await chrome.storage.local.remove(['access_token', 'refresh_token', 'spotify_refresh_token', 'code_verifier']);
            showNotConnectedState();
          }
        } else {
          console.log('Token refresh failed, clearing all tokens');
          await chrome.storage.local.remove(['access_token', 'refresh_token', 'spotify_refresh_token', 'code_verifier']);
          showNotConnectedState();
        }
      } else {
        console.log('No refresh token available');
        await chrome.storage.local.remove(['access_token']);
        showNotConnectedState();
      }
    } catch (error) {
      console.error('Status check error:', error);
      await chrome.storage.local.remove(['access_token', 'refresh_token', 'spotify_refresh_token', 'code_verifier']);
      showNotConnectedState();
    } finally {
      isUpdatingStatus = false;
    }
  }

  // Load platform preference
  async function loadPlatformPreference() {
    try {
      const { preferred_platform } = await chrome.storage.local.get(['preferred_platform']);
      const platform = preferred_platform || 'https://youtube.com';

      if (platformSelect) {
        platformSelect.value = platform;
      }
    } catch (error) {
      console.error('Error loading platform preference:', error);
    }
  }

  // Get preferred platform
  async function getPreferredPlatform() {
    try {
      const { preferred_platform } = await chrome.storage.local.get(['preferred_platform']);
      return preferred_platform || 'https://youtube.com';
    } catch (error) {
      console.error('Error getting platform preference:', error);
      return 'https://youtube.com';
    }
  }

  // Connect button handler
  if (authBtn) {
    authBtn.addEventListener('click', async () => {
      authBtn.classList.add('loading');
      buttonText.textContent = 'Connecting...';
      authBtn.disabled = true;

      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        const isOnYouTubeMusic = currentTab && currentTab.url && (currentTab.url.includes("music.youtube.com"));
        const isOnYouTube = currentTab && currentTab.url && currentTab.url.includes("youtube.com") && !currentTab.url.includes("music.youtube.com");
        const isOnAnyYouTube = isOnYouTubeMusic || isOnYouTube;

        if (isOnAnyYouTube) {
          const siteName = isOnYouTubeMusic ? "YouTube Music" : "YouTube";
          statusText.textContent = `Connecting to ${siteName}...`;
          try {
            await chrome.tabs.sendMessage(currentTab.id, { action: "manual_auth_trigger" });

            setTimeout(async () => {
              await updateConnectionStatus();
            }, 3000);
          } catch (error) {
            console.log("Content script not ready, injecting...");
            try {
              await chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                files: ["content.js"]
              });
              setTimeout(async () => {
                try {
                  await chrome.tabs.sendMessage(currentTab.id, { action: "manual_auth_trigger" });
                  setTimeout(async () => {
                    await updateConnectionStatus();
                  }, 3000);
                } catch (e) {
                  console.error("Still couldn't connect to content script:", e);
                  showNotConnectedState();
                }
              }, 1000);
            } catch (injectionError) {
              console.error("Failed to inject content script:", injectionError);
              showNotConnectedState();
            }
          }
        } else {
          const preferredPlatform = await getPreferredPlatform();
          const platformName = preferredPlatform.includes('music') ? 'YouTube Music' : 'YouTube';

          statusText.textContent = `Opening ${platformName}...`;
          const tab = await chrome.tabs.create({ url: preferredPlatform });

          chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
            if (tabId === tab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(async () => {
                try {
                  await chrome.tabs.sendMessage(tabId, { action: "manual_auth_trigger" });
                  setTimeout(async () => {
                    await updateConnectionStatus();
                  }, 3000);
                } catch (e) {
                  console.error("Failed to send message to new tab:", e);
                  showNotConnectedState();
                }
              }, 2000);
            }
          });
        }
      } catch (error) {
        console.error('Auth error:', error);
        chrome.tabs.create({ url: chrome.runtime.getURL("callback.html") });
        setTimeout(async () => {
          await updateConnectionStatus();
        }, 3000);
      }
    });
  }

  // Disconnect button handler
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      try {
        console.log("Disconnect button clicked");
        await notifyContentScriptsDisconnected();
        await chrome.storage.local.remove(['access_token', 'refresh_token', 'spotify_refresh_token', 'code_verifier']);
        await updateConnectionStatus();
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    });
  }

  // FIX: Debounce storage change listener to prevent racing with ongoing checks
  let storageChangeTimeout = null;
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.access_token || changes.refresh_token || changes.spotify_refresh_token)) {
      if (storageChangeTimeout) clearTimeout(storageChangeTimeout);
      storageChangeTimeout = setTimeout(() => {
        updateConnectionStatus();
      }, 500);
    }
  });

  // Initial status check
  showCheckingState();
  await updateConnectionStatus();

  // Periodically check connection status (every 5 minutes)
  setInterval(async () => {
    await updateConnectionStatus();
  }, 5 * 60 * 1000);
});