// background.js - Simple approach without ES6 modules

// Store credentials when extension is installed
chrome.runtime.onInstalled.addListener(() => {
    // TODO: Replace this with your actual Spotify Client ID from https://developer.spotify.com/dashboard
    const CLIENT_ID = "a0aeb4810add4986905a6a9327ff994c";
    
    chrome.storage.local.set({
        CLIENT_ID: CLIENT_ID,
    }, () => {
        console.log("Spotify CLIENT_ID has been stored in chrome.storage!");
        console.log("Client ID:", CLIENT_ID);
    });
});

// Handle tab updates to inject content script on YouTube Music
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only execute when the page is completely loaded and it's YouTube Music
    if (changeInfo.status === 'complete' && 
        tab.url && 
        tab.url.includes("music.youtube.com")) {
        
        chrome.storage.local.get(["CLIENT_ID"], (result) => {
            const clientId = result.CLIENT_ID;
            
            if (clientId) {
                // Inject CLIENT_ID as a global variable
                chrome.tabs.executeScript(tabId, {
                    code: `window.CLIENT_ID = "${clientId}"; console.log("CLIENT_ID injected:", window.CLIENT_ID);`
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error("Error injecting CLIENT_ID:", chrome.runtime.lastError);
                    } else {
                        // Inject your main content script
                        chrome.tabs.executeScript(tabId, {
                            file: "content.js"
                        });
                    }
                });
            } else {
                console.warn("CLIENT_ID not found in storage.");
            }
        });
    }
});

// Handle messages from content script (for OAuth callback)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'spotify_callback' && message.code) {
        // Forward the authorization code to the content script
        chrome.tabs.query({url: "*://music.youtube.com/*"}, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'process_auth_code',
                    code: message.code
                });
            }
        });
    }
    
    if (message.action === 'open_spotify_auth') {
        // Handle opening Spotify auth in a new tab if needed
        chrome.tabs.create({
            url: message.url,
            active: true
        });
    }
});

// Handle extension icon click (optional - for manual auth)
chrome.action.onClicked.addListener((tab) => {
    if (tab.url && tab.url.includes("music.youtube.com")) {
        // Send message to content script to initiate auth
        chrome.tabs.sendMessage(tab.id, {
            action: 'manual_auth_trigger'
        });
    }
});