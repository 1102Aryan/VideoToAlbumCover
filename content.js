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
  let lastTrackInfo = { artist: null, track: null };

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

    chrome.runtime.sendMessage({ type: "STORE_CODE_VERIFIER", codeVerifier: verifier });

    const challenge = base64encode(await sha256(verifier));

    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CONFIG.CLIENT_ID);
    url.searchParams.set("scope", "user-read-private user-read-email");
    url.searchParams.set("redirect_uri", CONFIG.REDIRECT_URI);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);

    chrome.runtime.sendMessage({ type: "OPEN_AUTH_TAB", url: url.toString() });
  }

  async function codeForToken(code) {
    await initializeConfig();

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

    chrome.runtime.sendMessage({
      type: "STORE_TOKENS",
      accessToken: data.access_token,
      refreshToken: data.refresh_token
    });

    if (data.refresh_token) {
      await storeRefreshToken(data.refresh_token);
    }

    console.log("Tokens stored successfully");
    startMonitoring();
  }

  function removeBracketTextFromTitle(track) {
    return track.replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, '').trim();
  }



  const DOMutils = {
    isRegularYouTube() {
      return window.location.hostname === "www.youtube.com" || window.location.hostname === "youtube.com";
    },

    isYouTubeMusic() {
      return window.location.hostname === "music.youtube.com";
    },

    getArtistName() {
      if (this.isYouTubeMusic()) {
        const selectors = [
          "ytmusic-player-bar yt-formatted-string.byline a",
          ".ytmusic-player-bar .subtitle a",
          ".byline.ytmusic-player-bar a"
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            console.log("Found YTM artist:", element.textContent.trim());
            return element.textContent.trim();
          }
        }
      } else if (this.isRegularYouTube()) {
        return this.extractArtistFromYouTube();
      }
      console.log("Artist not found");
      return null;
    },

    getSongName() {
      if (this.isYouTubeMusic()) {
        const selectors = [
          "yt-formatted-string.title.style-scope.ytmusic-player-bar",
          ".title.ytmusic-player-bar",
          "ytmusic-player-bar .title"
        ];

        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            console.log("Found YTM song:", element.textContent.trim());
            return element.textContent.trim();
          }
        }
      } else if (this.isRegularYouTube()) {
        return this.extractSongFromYouTube();
      }
      console.log("Song title not found");
      return null;
    },

    isVideoPlaying() {
      const videoElement = document.querySelector('video');
      return videoElement && !videoElement.paused;
    },

    getCurrentTime() {
      const videoElement = document.querySelector('video');
      return videoElement ? videoElement.currentTime : 0;
    },

    extractArtistFromYouTube() {
      const title = this.getYouTubeVideoTitle();
      if (!title) return null;

      const patterns = [
        /^(.+?)\s*[-–—]\s*(.+)$/, // Artist - Song
        /^(.+?)\s*[:|]\s*(.+)$/, // Artist: Song or Artist | Song
        /^(.+?)\s*"(.+?)"/, // Artist "Song"
        /^(.+?)\s*'(.+?)'/, // Artist 'Song'
        /^(.+?)\s*\(\s*(.+?)\s*\)/, // Artist (Song)
      ];

      for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match) {
          return match[1].trim();
        }
      }

      const description = this.getYouTubeDescription();
      const artistFromDesc = this.extractArtistFromDescription(description);
      if (artistFromDesc) return artistFromDesc;

      const channelName = this.getYouTubeChannelName();
      if (this.looksLikeArtistChannel(channelName)) {
        return channelName;
      }

      return null;
    },

    extractSongFromYouTube() {
      const title = this.getYouTubeVideoTitle();
      if (!title) return null;

      const patterns = [
        { regex: /^.+?\s*[-–—]\s*(.+)$/, songIndex: 1 }, // Artist - Song
        { regex: /^.+?\s*[:|]\s*(.+)$/, songIndex: 1 }, // Artist: Song or Artist | Song  
        { regex: /^.+?\s*"(.+?)"/, songIndex: 1 }, // Artist "Song"
        { regex: /^.+?\s*'(.+?)'/, songIndex: 1 }, // Artist 'Song'
        { regex: /^.+?\s*\(\s*(.+?)\s*\)/, songIndex: 1 }, // Artist (Song)
      ];

      for (const pattern of patterns) {
        const match = title.match(pattern.regex);
        if (match) {
          return match[pattern.songIndex].trim();
        }
      }

      return title;
    },

    getYouTubeVideoTitle() {
      const selectors = [
        'h1.ytd-watch-metadata yt-formatted-string',
        'h1.title yt-formatted-string',
        '#container h1 yt-formatted-string',
        '.ytd-video-primary-info-renderer h1 yt-formatted-string'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element.textContent.trim();
        }
      }
      return null;
    },

    getYouTubeDescription() {
      const descElement = document.querySelector('#description yt-formatted-string, .content yt-formatted-string');
      return descElement ? descElement.textContent : '';
    },

    getYouTubeChannelName() {
      const channelSelectors = [
        '#channel-name a',
        '.ytd-channel-name a',
        '#owner-name a'
      ];

      for (const selector of channelSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element.textContent.trim();
        }
      }
      return null;
    },

    extractArtistFromDescription(description) {
      const patterns = [
        /Artist:\s*(.+?)[\n\r]/i,
        /Performed by:\s*(.+?)[\n\r]/i,
        /Singer:\s*(.+?)[\n\r]/i,
        /Music by:\s*(.+?)[\n\r]/i,
      ];

      for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match) {
          return match[1].trim();
        }
      }
      return null;
    },

    looksLikeArtistChannel(channelName) {
      if (!channelName) return false;

      const skipPatterns = [
        /records?$/i,
        /music$/i,
        /official$/i,
        /label$/i,
        /entertainment$/i,
        /media$/i,
        /tv$/i,
        /network$/i,
        /channel$/i,
      ];

      return !skipPatterns.some(pattern => pattern.test(channelName));
    },

    isMusicVideo() {
      if (this.isYouTubeMusic()) return true;

      const title = this.getYouTubeVideoTitle()?.toLowerCase() || '';
      const description = this.getYouTubeDescription().toLowerCase();

      const musicKeywords = [
        'official music video', 'official video', 'music video',
        'official audio', 'full song', 'lyrics video',
        'acoustic', 'live performance', 'cover', 'remix',
        'single', 'album', 'ep', 'soundtrack'
      ];

      const hasKeywords = musicKeywords.some(keyword =>
        title.includes(keyword) || description.includes(keyword)
      );

      const hasArtistSongPattern = /^.+?\s*[-–—:|]\s*.+$/.test(title);

      return hasKeywords || hasArtistSongPattern;
    }
  };

  async function fetchAlbumImage(artist, track) {
    console.log("Fetching album image via background script for:", artist, "-", track);

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

  function hideYouTubeVideo() {
    console.log("Hiding YouTube video element...");

    const videoSelectors = [
      '.html5-main-video.video-stream',
      'video.html5-main-video',
      '#movie_player video',
      '.ytp-video-container video',
      'video.video-stream'
    ];

    let videoElement = null;

    for (const selector of videoSelectors) {
      videoElement = document.querySelector(selector);
      if (videoElement) {
        console.log(`Found video element with selector: ${selector}`);
        break;
      }
    }

    if (videoElement) {
      // Hide only the video, not the controls
      videoElement.style.opacity = '0';
      videoElement.style.zIndex = '-1';
      console.log("Video element hidden successfully (opacity method)");
      return true;
    } else {
      console.warn("Video element not found");
      return false;
    }
  }

  function showYouTubeVideo() {
    console.log("Showing YouTube video element...");

    const videoSelectors = [
      '.html5-main-video.video-stream',
      'video.html5-main-video',
      '#movie_player video',
      '.ytp-video-container video',
      'video.video-stream'
    ];

    let videoElement = null;

    for (const selector of videoSelectors) {
      videoElement = document.querySelector(selector);
      if (videoElement) {
        break;
      }
    }

    if (videoElement) {
      // Reset video visibility
      videoElement.style.opacity = '';
      videoElement.style.zIndex = '';
      console.log("Video element shown successfully");

      // Reset controls if they were modified
      const controlsSelectors = [
        '.ytp-chrome-bottom',
        '.ytp-chrome-controls',
        '.ytp-player-content',
        '.ytp-gradient-bottom',
        '.ytp-controls-visible'
      ];

      controlsSelectors.forEach(selector => {
        const element = document.querySelector(selector);
        if (element) {
          element.style.zIndex = '';
          // Don't reset position - let YouTube handle it
        }
      });
    }
  }

  function appendAlbumImageToVideoContainer(albumImage) {
    removeAlbumImage();

    // Create container for the album art and background
    const albumContainer = document.createElement("div");
    albumContainer.id = "album-container";

    // Create the album image element
    const imgElement = document.createElement("img");
    imgElement.id = "album-image";
    imgElement.alt = "Album Image";
    imgElement.src = albumImage;
    imgElement.crossOrigin = "anonymous";

    // Style the container to fill the video space
    albumContainer.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      z-index: 10 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background-color: #000 !important;
      transition: background-color 0.5s ease !important;
      pointer-events: none !important;
    `;

    // Style the album image to be smaller and centered
    imgElement.style.cssText = `
      max-width: 50% !important;
      max-height: 50% !important;
      width: auto !important;
      height: auto !important;
      object-fit: contain !important;
      border-radius: 12px !important;
      box-shadow: 0 12px 40px rgba(0,0,0,0.8) !important;
      transition: all 0.3s ease !important;
      pointer-events: auto !important;
    `;

    // Enhanced color extraction function
    function extractDominantColor(img) {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = 200;
        canvas.height = 200;

        ctx.drawImage(img, 0, 0, 200, 200);

        const imageData = ctx.getImageData(0, 0, 200, 200);
        const data = imageData.data;

        // Color frequency analysis for better dominant color
        const colorCount = {};

        for (let i = 0; i < data.length; i += 20) { // Sample every 5th pixel
          const r = Math.floor(data[i] / 10) * 10;
          const g = Math.floor(data[i + 1] / 10) * 10;
          const b = Math.floor(data[i + 2] / 10) * 10;

          // Skip very dark or very light colors
          if (r + g + b > 50 && r + g + b < 700) {
            const color = `${r},${g},${b}`;
            colorCount[color] = (colorCount[color] || 0) + 1;
          }
        }

        // Find most frequent color
        let dominantColor = '40,40,40'; // fallback
        let maxCount = 0;

        for (const [color, count] of Object.entries(colorCount)) {
          if (count > maxCount) {
            maxCount = count;
            dominantColor = color;
          }
        }

        // Parse RGB values and create darker versions
        const [r, g, b] = dominantColor.split(',').map(Number);

        // Create multiple shades for gradient
        const darkest = `rgb(${Math.floor(r * 0.1)}, ${Math.floor(g * 0.1)}, ${Math.floor(b * 0.1)})`;
        const dark = `rgb(${Math.floor(r * 0.2)}, ${Math.floor(g * 0.2)}, ${Math.floor(b * 0.2)})`;
        const medium = `rgb(${Math.floor(r * 0.4)}, ${Math.floor(g * 0.4)}, ${Math.floor(b * 0.4)})`;

        return { darkest, dark, medium, original: `rgb(${r}, ${g}, ${b})` };

      } catch (error) {
        console.log("Could not extract color from image:", error);
        return {
          darkest: '#0a0a0a',
          dark: '#1a1a1a',
          medium: '#2a2a2a',
          original: '#444444'
        };
      }
    }

    // Function to apply background color
    function applyBackgroundColor() {
      const colors = extractDominantColor(imgElement);
      console.log("Extracted color palette:", colors);

      // Create a rich gradient background that matches the album
      albumContainer.style.background = `
        radial-gradient(ellipse at center, 
          ${colors.medium} 0%, 
          ${colors.dark} 40%, 
          ${colors.darkest} 80%, 
          #000000 100%)
      `;

      // Add subtle animation
      albumContainer.style.backgroundSize = '150% 150%';
      albumContainer.style.animation = 'albumBackgroundShift 8s ease-in-out infinite alternate';

      // Add CSS animation keyframes
      if (!document.getElementById('album-animation-styles')) {
        const style = document.createElement('style');
        style.id = 'album-animation-styles';
        style.textContent = `
          @keyframes albumBackgroundShift {
            0% { background-position: 0% 50%; }
            100% { background-position: 100% 50%; }
          }
        `;
        document.head.appendChild(style);
      }
    }

    // Wait for image to load before extracting color
    imgElement.onload = function () {
      console.log("Album image loaded, extracting color palette...");
      setTimeout(applyBackgroundColor, 150);
    };

    // Error handling for image load
    imgElement.onerror = function () {
      console.log("Failed to load album image");
      albumContainer.style.background = 'radial-gradient(ellipse at center, #2a2a2a 0%, #1a1a1a 50%, #000000 100%)';
    };

    // Add image to container
    albumContainer.appendChild(imgElement);

    // Find video container and add our album container
    const containerSelectors = [
      '#movie_player',
      '.html5-video-container',
      '.ytp-video-container',
      '#player-container',
      '.video-container'
    ];

    let container = null;
    for (const selector of containerSelectors) {
      container = document.querySelector(selector);
      if (container) {
        console.log(`Found video container: ${selector}`);
        break;
      }
    }

    if (container) {
      const containerStyle = window.getComputedStyle(container);
      if (containerStyle.position === 'static') {
        container.style.position = 'relative';
      }

      container.appendChild(albumContainer);
      console.log("Album container added to video container");

      // Ensure YouTube controls remain visible and functional
      const controlsSelectors = [
        '.ytp-chrome-bottom',
        '.ytp-chrome-controls',
        '.ytp-player-content',
        '.ytp-gradient-bottom',
        '.ytp-controls-visible'
      ];

      controlsSelectors.forEach(selector => {
        const element = document.querySelector(selector);
        if (element) {
          element.style.zIndex = '200';
          element.style.pointerEvents = 'auto';
          // Don't change position - let YouTube handle positioning
        }
      });

      return true;
    } else {
      console.warn("Video container not found");
      return false;
    }
  }

  // Enhanced cleanup function
  function removeAlbumImage() {
    console.log("Removing album image and container...");

    // Remove animation styles
    const animationStyles = document.getElementById('album-animation-styles');
    if (animationStyles) {
      animationStyles.remove();
    }

    // Remove the album container
    const albumContainer = document.getElementById("album-container");
    if (albumContainer && albumContainer.parentNode) {
      albumContainer.parentNode.removeChild(albumContainer);
      console.log("Album container removed");
    }

    // Fallback cleanup
    const originalElement = document.getElementById("album-image");
    if (originalElement && originalElement.parentNode) {
      originalElement.parentNode.removeChild(originalElement);
      console.log("Album image removed (fallback)");
    }
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

  const showVideoPlaying = (src) => {
    // Check if it already exists
    if (document.getElementById("song-video")) {
      console.warn("Video already exists");
      return;
    }

    // Create a new video element
    const video = document.createElement("video");
    video.id = "song-video";
    video.src = src;  // pass video URL here
    video.controls = true;
    video.autoplay = true;
    video.width = 640; // set dimensions as needed
    video.height = 360;

    // Append it to a container in your page
    const container = document.getElementById("video-container");
    if (container) {
      container.appendChild(video);
    } else {
      console.error("No container found to append video");
    }
  };


  async function updateTrackInfo() {
    console.log("Updating track info...");

    if (DOMutils.isRegularYouTube() && !DOMutils.isMusicVideo()) {
      console.log("Not a music video, cleaning up and showing video");
      removeAlbumImage();
      showYouTubeVideo();
      return;
    }

    if (DOMutils.isYouTubeMusic()) {
      const hasVideo = document.querySelector("ytmusic-av-toggle[selected-item-has-video]");
      console.log("Has video:", hasVideo ? "Yes" : "No");

      if (!hasVideo) {
        removeAlbumImage();
        return;
      }
    }

    const artist = DOMutils.getArtistName();
    const rawTrack = DOMutils.getSongName();
    const cleanTrack = rawTrack ? removeBracketTextFromTitle(rawTrack) : null;

    console.log("Track info - Artist:", artist, "Track:", cleanTrack);

    if (artist === lastTrackInfo.artist && cleanTrack === lastTrackInfo.track) {
      console.log("Same track as before, skipping update");
      return;
    }

    lastTrackInfo = { artist, track: cleanTrack };

    if (artist && cleanTrack) {
      const albumImage = await fetchAlbumImage(artist, cleanTrack);
      if (albumImage) {
        if (DOMutils.isRegularYouTube()) {
          hideYouTubeVideo();
          appendAlbumImageToVideoContainer(albumImage);
        } else if (DOMutils.isYouTubeMusic()) {
          appendAlbumImage(albumImage);
          hideVideoPlaying();
        }
      } else {
        console.log("No album image found, cleaning up");
        removeAlbumImage();
        if (DOMutils.isRegularYouTube()) {
          showYouTubeVideo();
        } else if (DOMutils.isYouTubeMusic()) {
          //showVideoPlaying();
          showYouTubeMusicVideo();
        }
      }
    } else {
      console.log("Missing track info, cleaning up");
      removeAlbumImage();
      if (DOMutils.isRegularYouTube()) {
        showYouTubeVideo();
      }
    }
  }

  function showYouTubeMusicVideo() {
    console.log("Restoring YouTube Music video...");

    // Remove any album images first
    removeAlbumImage();

    // Find and restore the main video element
    const video = document.querySelector('video');
    if (video) {
      video.style.display = '';
      video.style.opacity = '';
      video.style.visibility = '';
      video.style.zIndex = '';
      console.log("Main video element restored");
    }

    // Also restore the song-video if it was removed
    const songVideo = document.getElementById('song-video');
    if (!songVideo) {
      // If song-video was removed, we need to trigger YouTube Music to recreate it
      // The most reliable way is to simulate clicking the video toggle
      const videoToggle = document.querySelector('ytmusic-av-toggle');
      if (videoToggle) {
        videoToggle.click();
        setTimeout(() => {
          videoToggle.click(); // Click twice to ensure video mode
        }, 100);
      }
    }
  }

  function startMonitoring() {
    if (isMonitoring) {
      console.log("Already monitoring, skipping...");
      setTimeout(() => {
        lastTrackInfo = { artist: null, track: null };
        updateTrackInfo();
      }, 100);
      return;
    }

    console.log("Starting track monitoring...");
    isMonitoring = true;

    if (observer) {
      observer.disconnect();
    }

    const setupObserver = () => {
      let targetElement;
      if (DOMutils.isYouTubeMusic()) {
        targetElement = document.querySelector("ytmusic-player-bar");
      } else if (DOMutils.isRegularYouTube()) {
        targetElement = document.querySelector("#content") || document.body;
      }

      if (!targetElement) {
        console.log("Target element not found, retrying in 500ms...");
        setTimeout(setupObserver, 500);
        return;
      }

      observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;

        for (const mutation of mutations) {
          if (DOMutils.isYouTubeMusic()) {
            if (mutation.type === 'childList') {
              const target = mutation.target;
              if (target.matches && (
                target.matches('.title') ||
                target.matches('.byline') ||
                target.closest('.title') ||
                target.closest('.byline') ||
                target.querySelector('.title') ||
                target.querySelector('.byline')
              )) {
                shouldUpdate = true;
                break;
              }
            }
          } else if (DOMutils.isRegularYouTube()) {
            if (mutation.type === 'childList') {
              const target = mutation.target;
              if (target.matches && (
                target.matches('h1') ||
                target.closest('h1') ||
                target.querySelector('h1') ||
                target.id === 'content'
              )) {
                shouldUpdate = true;
                break;
              }
            }
          }
        }

        if (shouldUpdate) {
          console.log("Relevant track change detected");
          setTimeout(updateTrackInfo, 100);
        }
      });

      observer.observe(targetElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['title', 'aria-label']
      });

      console.log("Observer set up successfully");

      console.log("Checking current track immediately...");
      setTimeout(() => {
        console.log("Checking current track immediately...");
        lastTrackInfo = { artist: null, track: null }; // Reset to force update
        updateTrackInfo();
      }, DOMutils.isRegularYouTube() ? 300 : 200);
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
      return true;
    }

    if (msg.action === "manual_auth_trigger") {
      console.log("Manual authorization triggered.");
      redirectToSpotify();
      sendResponse({ success: true });
      return true;
    }

    if (msg.action === "authorizationComplete") {
      console.log("Authorization completed, starting track monitoring immediately...");
      startMonitoring();
      sendResponse({ success: true });
      return true;
    }

    if (msg.action === "extensionDisconnected") {
      console.log("Extension disconnected, cleaning up...");

      // Stop monitoring
      stopMonitoring();

      // Clean up album images and restore video
      removeAlbumImage();
      if (DOMutils.isRegularYouTube()) {
        showYouTubeVideo();
      } else if (DOMutils.isYouTubeMusic()) {
        showYouTubeMusicVideo();
      }

      // Reset tracking variables
      lastTrackInfo = { artist: null, track: null };

      sendResponse({ success: true });
      return true;
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      // Check if access token was removed (disconnect)
      if (changes.access_token && !changes.access_token.newValue && changes.access_token.oldValue) {
        console.log("Access token removed, cleaning up extension...");

        // Stop monitoring
        stopMonitoring();

        // Clean up album images and restore video
        removeAlbumImage();
        if (DOMutils.isRegularYouTube()) {
          showYouTubeVideo();
        } else if (DOMutils.isYouTubeMusic()) {
          showYouTubeMusicVideo();
        }

        // Reset tracking variables
        lastTrackInfo = { artist: null, track: null };
      }
      // Check if access token was added (connect)
      else if (changes.access_token && changes.access_token.newValue && !changes.access_token.oldValue) {
        console.log("Access token added, starting monitoring...");

        setTimeout(() => {
          startMonitoring();
        }, 1000);
      }
    }
  });

  let currentUrl = window.location.href;

  const handleNavigation = () => {
    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;
      console.log("Navigation detected:", currentUrl);

      lastTrackInfo = { artist: null, track: null };

      // Always clean up on navigation
      removeAlbumImage();
      if (DOMutils.isRegularYouTube()) {
        showYouTubeVideo();
      } else if (DOMutils.isYouTubeMusic()) {
        showYouTubeMusicVideo();
        //showVideoPlaying();
      }

      setTimeout(() => {
        if (isMonitoring) {
          stopMonitoring();
          startMonitoring();
        }
      }, 300);
    }
  };

  window.addEventListener('yt-navigate-finish', handleNavigation);
  window.addEventListener('popstate', handleNavigation);

  setInterval(handleNavigation, 1000);

  // Add debugging function
  window.debugCleanup = function () {
    console.log("=== MANUAL CLEANUP DEBUG ===");
    console.log("Album container exists:", !!document.getElementById("album-container"));
    console.log("Album image exists:", !!document.getElementById("album-image"));
    console.log("Animation styles exist:", !!document.getElementById('album-animation-styles'));
    console.log("Current URL:", window.location.href);
    console.log("Is music video:", DOMutils.isMusicVideo());

    removeAlbumImage();
    showYouTubeVideo();

    console.log("After cleanup - Album container exists:", !!document.getElementById("album-container"));
    console.log("After cleanup - Album image exists:", !!document.getElementById("album-image"));
  };

  initializeConfig().then(async () => {
    console.log("Config initialized for:", window.location.hostname);

    const token = await getStoredToken();
    if (token && await isTokenValid()) {
      console.log("Valid token found, starting monitoring...");
      setTimeout(() => {
        startMonitoring();
      }, DOMutils.isRegularYouTube() ? 400 : 200);
    } else {
      console.log("No valid token found, waiting for authorization...");
    }
  });

  window.addEventListener('beforeunload', () => {
    stopMonitoring();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isMonitoring) {
      console.log("Tab became active, checking track info...");
      setTimeout(updateTrackInfo, 100);
    }
  });

})();