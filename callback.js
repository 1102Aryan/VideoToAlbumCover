const CONFIG = {
    CLIENT_ID: "a0aeb4810add4986905a6a9327ff994c",
    SPOTIFY_AUTHORIZE_URL: "https://accounts.spotify.com/authorize",
    SPOTIFY_TOKEN_URL: "https://accounts.spotify.com/api/token",
};

const redirectUri = chrome.runtime.getURL("callback.html");
const scope = 'user-read-private user-read-email user-read-playback-state user-read-currently-playing';
const clientId = CONFIG.CLIENT_ID;

const generateRandomString = (length) => {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
};

const sha256 = async (plain) => {
    const data = new TextEncoder().encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
};

const base64encode = (input) => {
    return btoa(String.fromCharCode(...new Uint8Array(input)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

async function startAuthorizationFlow() {
    const codeVerifier = generateRandomString(64);
    chrome.storage.local.set({ code_verifier: codeVerifier });

    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope,
        redirect_uri: redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
    });

    window.location.href = `${CONFIG.SPOTIFY_AUTHORIZE_URL}?${params}`;
}

async function getAccessTokenFromCode(code) {
    const { code_verifier } = await chrome.storage.local.get(['code_verifier']);

    const payload = new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier,
    });

    try {
        const res = await fetch(CONFIG.SPOTIFY_TOKEN_URL, {
            method: "POST",
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: payload,
        });

        const data = await res.json();
        if (data.access_token) {
            chrome.storage.local.set({ 
                access_token: data.access_token,
                refresh_token: data.refresh_token 
            });
            
            // Send message to background script to handle tab messaging
            chrome.runtime.sendMessage({
                type: "AUTHORIZATION_COMPLETE",
                accessToken: data.access_token,
                refreshToken: data.refresh_token
            });

            // Close immediately without showing HTML
            window.close();
        } else {
            console.error("Authorization failed - no access token received");
            setTimeout(() => window.close(), 1000);
        }
    } catch (err) {
        console.error("Token exchange error:", err);
        setTimeout(() => window.close(), 1000);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "authorizationComplete") {
        console.log("Authorization completed — Spotify token available!");
        sendResponse({ success: true });
    }
});

window.addEventListener("load", () => {
    console.log("Callback page loaded");
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error) {
        console.error("Authorization error:", error);
        setTimeout(() => window.close(), 500);
        return;
    }

    if (code) {
        console.log("[Callback] Found code in URL:", code);
        getAccessTokenFromCode(code);
    } else {
        startAuthorizationFlow(); // if no code, restart auth
    }
});