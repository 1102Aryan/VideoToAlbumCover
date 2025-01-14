import { CONFIGS } from './config.js';

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        CLIENT_ID: CONFIGS.CLIENT_ID,
        CLIENT_SECRET: CONFIGS.CLIENT_SECRET,
    }, () => {
        console.log("Spotify API credentials have been stored in chrome.storage!");
    });
});


chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.url && tab.url.includes("music.youtube.com/watch")) {
        chrome.storage.local.get(["CLIENT_ID", "CLIENT_SECRET"], (result) => {
            const clientId = result.CLIENT_ID;
            const clientSecret = result.CLIENT_SECRET;

            // Check if credentials are available
            if (clientId && clientSecret) {
                // Pass the credentials to the content script
                chrome.scripting.executeScript({
                    target: { tabId },
                    func: (id, secret) => {
                        // Inject credentials into the content script
                        window.CLIENT_ID = id;
                        window.CLIENT_SECRET = secret;
                    },
                    args: [clientId, clientSecret], // Pass retrieved credentials as arguments
                });

                // Inject the content script
                chrome.scripting.executeScript({
                    target: { tabId },
                    files: ["content.js"],
                });
            } else {
                console.warn("CLIENT_ID or CLIENT_SECRET not found in chrome.storage.");
            }
        });
    }
});