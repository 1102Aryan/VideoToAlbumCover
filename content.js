const CONFIG = {
	CLIENT_ID : window.CLIENT_ID,
	SPOTIFY_URL : "https://api.spotify.com/v1/search?q=",
	REDIRECT_URI : "moz-extension://dc6bb261-31aa-48dd-9dd1-01748f937f22/callback.html"
};

function initializeConfig() {
	if (chrome?.runtime?.id) {
		CONFIG.REDIRECT_URI = `chrome-extension://${chrome.runtime.id}/callback.html`;
	}
}

// Code verifier PKCE 
const generateRandomString = (length) => {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const values = crypto.getRandomValues(new Uint8Array(length));
	return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}
 
const sha256 = async (plain) => {
	const encoder = new TextEncoder()
	const data = encoder.encode(plain)
	return window.crypto.subtle.digest('SHA-256', data)
}

const base64encode = (input) => {
	return btoa(String.fromCharCode(...new Uint8Array(input)))
	  .replace(/=/g, '')
	  .replace(/\+/g, '-')
	  .replace(/\//g, '_');
}

async function isTokenValid() {
	const token = getStoredToken();
	if (!token) return false;

	try {
        const response = await fetch('https://api.spotify.com/v1/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return response.ok;
    } catch (error) {
        console.error('Token validation error:', error);
        return false;
    }
}

// Get stored token with fallback to chrome.storage
function getStoredToken() {
    // Try localStorage first (for compatibility)
    let token = localStorage.getItem('spotify_access_token');
    if (token) return token;

    // Fallback to chrome.storage if available
    if (chrome?.storage?.local) {
        chrome.storage.local.get(['spotify_access_token'], (result) => {
            return result.spotify_access_token || null;
        });
    }
    return null;
}

// Store token with fallback to chrome.storage
function storeToken(token) {
    // Store in localStorage for immediate access
    localStorage.setItem('spotify_access_token', token);
    
    // Also store in chrome.storage for persistence
    if (chrome?.storage?.local) {
        chrome.storage.local.set({ 'spotify_access_token': token });
    }
}

const redirectToSpotify = async () => {
    // Ensure config is initialized
    initializeConfig();
    
    // Get CLIENT_ID from chrome storage if not available
    if (!CONFIG.CLIENT_ID) {
        await new Promise((resolve) => {
            if (chrome?.storage?.local) {
                chrome.storage.local.get(["CLIENT_ID"], (res) => {
                    CONFIG.CLIENT_ID = res.CLIENT_ID;
                    resolve();
                });
            } else {
                console.error("Chrome storage not available");
                resolve();
            }
        });
    }

    if (!CONFIG.CLIENT_ID) {
        console.error("CLIENT_ID not found. Please set it in extension options.");
        return;
    }

    const codeVerifier = generateRandomString(64);
    localStorage.setItem('spotify_code_verifier', codeVerifier);

    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    const scope = "user-read-private user-read-email";

    const authUrl = new URL("https://accounts.spotify.com/authorize");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", CONFIG.CLIENT_ID);
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("redirect_uri", CONFIG.REDIRECT_URI);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    
    console.log("Redirecting to Spotify authorization:", authUrl.toString());
    window.location.href = authUrl.toString();
}

async function codeForToken(code) {
    initializeConfig();
    
    const codeVerifier = localStorage.getItem('spotify_code_verifier');
    
    if (!codeVerifier) {
        throw new Error("Code verifier not found in localStorage");
    }

    if (!CONFIG.CLIENT_ID) {
        await new Promise((resolve) => {
            if (chrome?.storage?.local) {
                chrome.storage.local.get(["CLIENT_ID"], (res) => {
                    CONFIG.CLIENT_ID = res.CLIENT_ID;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: CONFIG.CLIENT_ID,
            grant_type: "authorization_code",
            code: code,
            redirect_uri: CONFIG.REDIRECT_URI,
            code_verifier: codeVerifier,
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        console.error("Token exchange error:", errorData);
        throw new Error(`Failed to exchange code for token: ${response.status}`);
    }

    const data = await response.json();
    storeToken(data.access_token);
    
    // Store refresh token if provided
    if (data.refresh_token) {
        localStorage.setItem("spotify_refresh_token", data.refresh_token);
        if (chrome?.storage?.local) {
            chrome.storage.local.set({ 'spotify_refresh_token': data.refresh_token });
        }
    }
    
    // Clean up code verifier
    localStorage.removeItem('spotify_code_verifier');
    
    console.log("Access token stored successfully");
    return data.access_token;
}

// Refresh token if available
async function refreshAccessToken() {
    const refreshToken = localStorage.getItem('spotify_refresh_token') || 
                        (chrome?.storage?.local ? await new Promise(resolve => {
                            chrome.storage.local.get(['spotify_refresh_token'], (result) => {
                                resolve(result.spotify_refresh_token);
                            });
                        }) : null);

    if (!refreshToken) {
        console.log("No refresh token available, redirecting to auth");
        await redirectToSpotify();
        return null;
    }

    try {
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                client_id: CONFIG.CLIENT_ID,
                grant_type: "refresh_token",
                refresh_token: refreshToken,
            }),
        });

        if (!response.ok) {
            console.log("Refresh token invalid, redirecting to auth");
            await redirectToSpotify();
            return null;
        }

        const data = await response.json();
        storeToken(data.access_token);
        console.log("Access token refreshed successfully");
        return data.access_token;
    } catch (error) {
        console.error("Error refreshing token:", error);
        await redirectToSpotify();
        return null;
    }
}

function removeBracketTextFromTitle(track) {
	return track.replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, '').trim();	
}

const DOMutils = {	
	getArtistName() {
		const getArtistElement = document.querySelector(
			"ytmusic-player-bar yt-formatted-string.byline.style-scope.ytmusic-player-bar a"
		);
		if (getArtistElement) {
			const artist = getArtistElement.textContent.trim().replace(/\s+/g, " ");
			console.log("Artist Name: ", artist);
			return artist;
		} else {
			console.log("Cannot find artist attribute");
			return null;
		}
	},
	getSongName() {
		const getSongElement = document.querySelector("yt-formatted-string.title.style-scope.ytmusic-player-bar");
		if (getSongElement) {
			const track = getSongElement.textContent.trim().replace(/\s+/g, " ");
			console.log("Song Name:", track);
			return track
		} else {
			console.log("Cannot find song attribute");
			return null;
		}
	}
}

function removeAlbumImage() {
    const originalElement = document.getElementById("album-image");
    if (originalElement && originalElement.parentNode) {
        originalElement.parentNode.removeChild(originalElement);
        console.log("Previous album image removed");
    }
}

function appendAlbumImage(albumImage) {
	const orginalElement = document.getElementById("album-image")
	if(orginalElement) {
		if (orginalElement.src !== albumImage) {
			orginalElement.src = albumImage;
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

// async function getSpotifyAccessToken() {
//     const tokenUrl = "https://accounts.spotify.com/api/token";


//     const credentials = btoa(`${CONFIG.CLIENT_ID}:${CONFIG.CLIENT_SECRET}`);

//     try {
//         const response = await fetch(tokenUrl, {
//             method: "POST",
//             headers: {
//                 "Authorization": `Basic ${credentials}`,
//                 "Content-Type": "application/x-www-form-urlencoded",
//             },
//             body: "grant_type=client_credentials",
//         });

//         if (!response.ok) {
//             throw new Error(`Failed to retrieve access token: ${response.status}`);
//         }

//         const data = await response.json();
//         return data.access_token; // Return the access token
//     } catch (error) {
//         console.error("Error fetching Spotify access token:", error);
//         return null;
//     }
// }

async function fetchAlbumName(artist, track) {
    let token = getStoredToken();
    
    // Check if token is valid
    if (!token || !(await isTokenValid())) {
        console.log("Token invalid or missing, attempting to refresh");
        token = await refreshAccessToken();
        if (!token) {
            console.warn("Could not obtain valid token");
            return null;
        }
    }

    const query = `${artist} ${track}`;
    const baseUrl = `${CONFIG.SPOTIFY_URL}${encodeURIComponent(query)}&type=track&limit=1`;

    try {
        const response = await fetch(baseUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (response.status === 401) {
            // Token expired, try to refresh
            console.log("Token expired, attempting refresh");
            token = await refreshAccessToken();
            if (!token) return null;
            
            // Retry the request with new token
            const retryResponse = await fetch(baseUrl, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            
            if (!retryResponse.ok) {
                throw new Error(`HTTP error: status ${retryResponse.status}`);
            }
            
            const retryData = await retryResponse.json();
            const albumImage = retryData.tracks?.items[0]?.album?.images?.[0]?.url || null;
            console.log("Album Image URL from Spotify (retry):", albumImage);
            return albumImage;
        }

        if (!response.ok) {
            throw new Error(`HTTP error: status ${response.status}`);
        }

        const data = await response.json();
        const albumImage = data.tracks?.items[0]?.album?.images?.[0]?.url || null;
        console.log("Album Image URL from Spotify:", albumImage);
        return albumImage;
    } catch (error) {
        console.error("Error fetching album info from Spotify:", error);
        return null;
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

async function updateTrackInfo() {
	const toggleElement = document.querySelector("ytmusic-av-toggle");
	console.log(toggleElement?.outerHTML);
	if (toggleElement?.hasAttribute("selected-item-has-video")) {
		const artist = DOMutils.getArtistName();
		const track = DOMutils.getSongName();
		const cleanedTrack = removeBracketTextFromTitle(track);
		console.log("Removed text between brackets:", cleanedTrack);
		if (artist && cleanedTrack) {
			try {
				const albumImage = await fetchAlbumName(artist, cleanedTrack);
				if (albumImage) {
					appendAlbumImage(albumImage);
					console.log("Image should be appearing now"); 
				} else {
					console.warn("No album image found.");
					const unknownAlbum = "blankart.jpg";
					appendAlbumImage(unknownAlbum);
				}
			} catch (error) {
				console.error("Error in updateTrackInfo:", error);
			}
		}
	} else {
		console.log("selected-item-has-video does not exist?");
		removeAlbumImage();
	}
	console.log("completed run!");
}

function observeTrackChanges() {
    const playerBar = document.querySelector("ytmusic-player-bar");
    if (!playerBar) {
        console.warn("Player bar not found.");
        return;
    }

    const observer = new MutationObserver(async () => {
        await updateTrackInfo();
    });

    observer.observe(playerBar, { childList: true, subtree: true });
}

async function initialize() {
    initializeConfig();
    hideVideoPlaying();
    observeTrackChanges();
}

// Start the extension
initialize();

