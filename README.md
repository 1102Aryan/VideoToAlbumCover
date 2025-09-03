# Video To Album Cover

## Description
Transform your YouTube and YouTube Music experience by replacing distracting music videos with beautiful album artwork. Focus on the music, not the visuals.

## 📸 Screenshots

### YouTube Music - Album View
![YouTube Music with album cover](Images/image-1.png)
*Experience distraction-free listening with beautiful album artwork*

### Regular YouTube - Music Detection
![YouTube video replaced with album art](Images/image-2.png)
*Smart detection works on regular YouTube for music videos too*

## 📋 Requirements

- Chrome/Chromium browser version 90 or higher
- Spotify account (free or premium)
- Active internet connection

## 📥 Installation

- Available on [Chrome Web Store](https://chromewebstore.google.com/detail/video-to-album-cover-for/hpdfnknolcfbimcnngknidjgpddjfhgl?authuser=1&hl=en-GB)

### Manual Installation (Developer Mode)

1. **Download the Extension**
   ```bash
   git clone https://github.com/1102Aryan/VideoToAlbumCover.git
   ```
   Or download the [latest release](https://github.com/1102Aryan/VideoToAlbumCover/releases)

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions/`
   - Or click Menu (⋮) → More Tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top right corner

4. **Load the Extension**
   - Click "Load unpacked"
   - Select the downloaded extension folder
   - The extension icon should appear in your toolbar

## 🚀 Getting Started

### Initial Setup

1. **Click the extension icon** in your browser toolbar
2. **Click "Connect to Spotify"** to authorize the extension
3. **Log in to your Spotify account** when prompted
4. **Return to YouTube/YouTube Music** and enjoy!

### Usage

Once connected, the extension works automatically:

1. Navigate to [YouTube Music](https://music.youtube.com) or [YouTube](https://youtube.com)
2. Play any music video or song
3. The video will be replaced with the album artwork
4. Playback controls remain fully functional

### Managing Connection

- **Check Status**: Click the extension icon to see connection status
- **Disconnect**: Click "Disconnect" in the popup to revoke Spotify access
- **Reconnect**: Simply click "Connect to Spotify" again

## 🎯 How It Works

1. **Track Detection**: Identifies artist and song information from YouTube
2. **Spotify Search**: Queries Spotify API for matching album artwork
3. **Visual Replacement**: Hides video element and displays album art

## ❓ FAQ

### Why do I need to connect to Spotify?
The extension uses Spotify's extensive music database to fetch high-quality album artwork. Your Spotify account is only used for API access - no personal data is stored.

### Does this work with all videos?
The extension specifically targets music content. It won't affect non-music videos like vlogs, tutorials, or podcasts.

### The wrong album cover is showing
Some factors can affect accuracy:
- Remix versions may show original album art
- Live performances might not have specific covers
- Title formatting (feat., vs., &) can impact matching

**To report an issue:**
1. Note the exact video title and URL
2. Take a screenshot if possible
3. [Open an issue](https://github.com/1102Aryan/VideoToAlbumCover/issues) with details

### Can I use this without Spotify Premium?
Yes! A free Spotify account works perfectly. Premium is not required.

### Does this affect video quality or performance?
No, the video continues playing normally in the background. Only the visual element is replaced.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 Privacy

- **No data collection**: The extension doesn't collect or store personal information
- **Local storage only**: Spotify tokens are stored locally in your browser
- **No tracking**: No analytics or tracking scripts included
- **Open source**: All code is available for review


## 🙏 Acknowledgments

- Spotify Web API for album artwork
- YouTube Music for the inspiration
- All contributors and users