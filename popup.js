// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const authBtn = document.getElementById('auth-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const buttonText = document.getElementById('button-text');

  // Check connection status on load
  await updateConnectionStatus();

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
      
      if (currentTab && currentTab.url && currentTab.url.includes("music.youtube.com")) {
        // We're on YouTube Music, send message to content script
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
      // Clear stored tokens
      await chrome.storage.local.remove(['access_token', 'refresh_token', 'spotify_refresh_token', 'code_verifier']);
      await updateConnectionStatus();
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  });

  // Update connection status
  async function updateConnectionStatus() {
    try {
      const { access_token } = await chrome.storage.local.get(['access_token']);
      
      if (access_token) {
        showConnectedState();
      } else {
        showNotConnectedState();
      }
    } catch (error) {
      console.error('Status check error:', error);
      showNotConnectedState();
    }
  }

  function showConnectedState() {
    // Update status indicator
    if (statusIndicator) {
      statusIndicator.classList.remove('disconnected');
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
      statusIndicator.classList.remove('connected');
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

  // Listen for storage changes to update status in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.access_token || changes.refresh_token)) {
      updateConnectionStatus();
    }
  });
});