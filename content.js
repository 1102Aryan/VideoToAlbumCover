const CONFIG = {
	CLIENT_ID : window.CLIENT_ID,
	CLIENT_SECRET : window.CLIENT_SECRET,
	SPOTIFY_URL : "https://api.spotify.com/v1/search?q=",
};

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

function appendAblumImage(albumImage) {
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

async function getSpotifyAccessToken() {
    const tokenUrl = "https://accounts.spotify.com/api/token";


    const credentials = btoa(`${CONFIG.CLIENT_ID}:${CONFIG.CLIENT_SECRET}`);

    try {
        const response = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                "Authorization": `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
        });

        if (!response.ok) {
            throw new Error(`Failed to retrieve access token: ${response.status}`);
        }

        const data = await response.json();
        return data.access_token; // Return the access token
    } catch (error) {
        console.error("Error fetching Spotify access token:", error);
        return null;
    }
}

async function fetchAlbumName(artist, track) {
    const token = await getSpotifyAccessToken();
    const query = `${artist} ${track}`;
    const baseUrl = `${CONFIG.SPOTIFY_URL}${encodeURIComponent(query)}&type=track&limit=1`;

    try {
        const response = await fetch(baseUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

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
		console.warn(`Element with ID '${id}' not found`);
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
					appendAblumImage(albumImage);
					console.log("Image should be appearing now"); 
				} else {
					console.warn("No album image found.");
					const unknownAlbum = "blankart.jpg";
					appendAblumImage(unknownAlbum);
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

hideVideoPlaying();
observeTrackChanges();

