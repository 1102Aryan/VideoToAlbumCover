// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const authBtn = document.getElementById('auth-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const buttonText = document.getElementById('button-text');

  // IMPORTANT: Show loading/checking state initially, not connected or disconnected
  showCheckingState();

  // Check connection status on load
  await updateConnectionStatus();

  // Function to show checking/loading state
  function showCheckingState() {
    // Update status indicator to neutral state
    if (statusIndicator) {
      statusIndicator.classList.remove('connected', 'disconnected');
      statusIndicator.classList.add('checking'); // You may need to add CSS for this
    }
    if (statusText) {
      statusText.textContent = 'Checking connection...';
    }

    // Hide both buttons during check
    if (authBtn) authBtn.classList.add('hidden');
    if (disconnectBtn) disconnectBtn.classList.add('hidden');
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
                } else {
                  console.log("Disconnect notification sent to tab:", tab.id);
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
    
    // Wait for all notifications to be sent
    await Promise.all(notifyPromises);
  }

  // Connect button handler
  authBtn.addEventListener('click', async () => {
    // Show loading state
    authBtn.classList.add('loading');
    buttonText.textContent = 'Connecting...';
    authBtn.disabled = true;

    try {
      // First check if we're on a YouTube Music tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];
      const isOnYouTubeMusic = currentTab && currentTab.url && (currentTab.url.includes("music.youtube.com"));
      const isOnYouTube = currentTab && currentTab.url && currentTab.url.includes("youtube.com") && !currentTab.url.includes("music.youtube.com");
      const isOnAnyYouTube = isOnYouTubeMusic || isOnYouTube;
      
      if (isOnAnyYouTube) {
        // We're on YouTube Music, send message to content script
        const siteName = isOnYouTubeMusic ? "YouTube Music" : "YouTube";
        statusText.textContent = `Connecting to ${siteName}...`;
        try {
          await chrome.tabs.sendMessage(currentTab.id, { action: "manual_auth_trigger" });
          
          // Wait for auth to complete, then update status
          setTimeout(async () => {
            await updateConnectionStatus();
          }, 3000);
        } catch (error) {
          console.log("Content script not ready, injecting...");
          // Inject content script if not already present
          try {
            await chrome.scripting.executeScript({
              target: { tabId: currentTab.id },
              files: ["content.js"]
            });
            // Wait a bit and try again
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
        // Not on YouTube Music, open YouTube Music first
        statusText.textContent = 'Opening YouTube Music...';
        const ytMusicTab = await chrome.tabs.create({ url: "https://music.youtube.com" });
        
        // Wait for the tab to load and inject content script
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
          if (tabId === ytMusicTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            // Send message after a short delay to ensure content script is ready
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
      // Fallback: just open the auth flow directly
      chrome.tabs.create({ url: chrome.runtime.getURL("callback.html") });
      setTimeout(async () => {
        await updateConnectionStatus();
      }, 3000);
    }
  });

  // Disconnect button handler
  disconnectBtn.addEventListener('click', async () => {
    try {
      console.log("Disconnect button clicked");
      
      // Notify content scripts to clean up BEFORE clearing tokens
      await notifyContentScriptsDisconnected();
      
      // Clear stored tokens
      await chrome.storage.local.remove(['access_token', 'refresh_token', 'spotify_refresh_token', 'code_verifier']);
      await updateConnectionStatus();
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });

  // Update connection status - ENHANCED VERSION
  async function updateConnectionStatus() {
    try {
      const { access_token, spotify_refresh_token, refresh_token } = await chrome.storage.local.get(['access_token', 'spotify_refresh_token', 'refresh_token']);
      
      // If no tokens at all, definitely not connected
      if (!access_token && !spotify_refresh_token && !refresh_token) {
        console.log('No tokens found, not connected');
        showNotConnectedState();
        return;
      }

      // Show checking state while validating
      showCheckingState();

      // If we have an access token, validate it
      if (access_token) {
        const isValid = await validateSpotifyToken(access_token);
        
        if (isValid) {
          console.log('Access token is valid');
          showConnectedState();
          return;
        } else {
          console.log('Access token is invalid');
        }
      }

      // Token is invalid or missing, try to refresh if we have refresh token
      if (spotify_refresh_token || refresh_token) {
        console.log('Attempting to refresh token...');
        const refreshSuccess = await refreshAccessToken();

        if (refreshSuccess) {
          console.log('Token refresh successful');
          showConnectedState();
        } else {
          console.log('Token refresh failed, clearing all tokens');
          // Clear all invalid tokens
          await chrome.storage.local.remove(['access_token', 'refresh_token', 'spotify_refresh_token', 'code_verifier']);
          showNotConnectedState();
        }
      } else {
        // No refresh token available
        console.log('No refresh token available');
        await chrome.storage.local.remove(['access_token']); // Clear invalid access token
        showNotConnectedState();
      }
    } catch (error) {
      console.error('Status check error:', error);
      // On error, clear potentially corrupted tokens
      await chrome.storage.local.remove(['access_token', 'refresh_token', 'spotify_refresh_token', 'code_verifier']);
      showNotConnectedState();
    }
  }

  function showConnectedState() {
    // Update status indicator
    if (statusIndicator) {
      statusIndicator.classList.remove('disconnected', 'checking');
      statusIndicator.classList.add('connected');
    }
    if (statusText) {
      statusText.textContent = 'Connected to Spotify';
    }

    // Show disconnect button, hide connect button
    if (authBtn) authBtn.classList.add('hidden');
    if (disconnectBtn) disconnectBtn.classList.remove('hidden');

    // Remove loading state
    if (authBtn) {
      authBtn.classList.remove('loading');
      authBtn.disabled = false;
    }
  }

  function showNotConnectedState() {
    // Update status indicator
    if (statusIndicator) {
      statusIndicator.classList.remove('connected', 'checking');
      statusIndicator.classList.add('disconnected');
    }
    if (statusText) {
      statusText.textContent = 'Not Connected';
    }

    // Show connect button, hide disconnect button
    if (authBtn) authBtn.classList.remove('hidden');
    if (disconnectBtn) disconnectBtn.classList.add('hidden');

    // Reset button text and state
    if (buttonText) buttonText.textContent = 'Connect to Spotify';
    if (authBtn) {
      authBtn.classList.remove('loading');
      authBtn.disabled = false;
    }
  }

  // Validates token with spotify API - ENHANCED VERSION
  async function validateSpotifyToken(accessToken) {
    try {
      return new Promise((resolve) => {
        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
          console.log('Token validation timeout');
          resolve(false);
        }, 5000);

        chrome.runtime.sendMessage({
          type: "VALIDATE_TOKEN",
          accessToken: accessToken
        }, (response) => {
          clearTimeout(timeout);
          
          if (chrome.runtime.lastError) {
            console.error('Token validation error:', chrome.runtime.lastError);
            resolve(false);
          } else {
            resolve(response?.isValid || false);
          }
        });
      });
    } catch (error) {
      console.error('Token validation error:', error);
      return false;
    }
  }

  // Try to refresh the access token using refresh token - ENHANCED VERSION
  async function refreshAccessToken() {
    try {
      // Get refresh token and client ID from storage
      const { spotify_refresh_token, refresh_token } = await chrome.storage.local.get(['spotify_refresh_token', 'refresh_token']);
      const refreshToken = spotify_refresh_token || refresh_token;

      if (!refreshToken) {
        console.log('No refresh token available');
        return false;
      }

      // Get CLIENT_ID from background script
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
        
        // Store the new access token
        await chrome.storage.local.set({
          access_token: data.access_token
        });
        
        // Update refresh token if a new one is provided
        if (data.refresh_token) {
          await chrome.storage.local.set({
            spotify_refresh_token: data.refresh_token,
            refresh_token: data.refresh_token
          });
        }
        
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

  // Listen for storage changes to update status in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.access_token || changes.refresh_token || changes.spotify_refresh_token)) {
      // Only update if we're not already checking
      if (statusText && statusText.textContent !== 'Checking connection...') {
        updateConnectionStatus();
      }
    }
  });

  // Periodically check connection status (every 5 minutes)
  setInterval(async () => {
    await updateConnectionStatus();
  }, 5 * 60 * 1000);
});