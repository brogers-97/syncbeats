# 🎧 SyncBeats

A synced music queue app for gaming sessions. Listen to music together with friends while gaming!

## Features

- **Create & Join Rooms** - Host creates a room and shares a 6-character code with friends
- **Shared Queue** - Everyone can add YouTube songs to the queue
- **Synced Playback** - Music plays simultaneously for everyone in the room
- **Host Controls** - Host can play/pause, skip, reorder, and remove songs
- **Desktop Widget** - Small, always-on-top window perfect for gaming
- **Drag & Drop** - Host can reorder the queue by dragging songs

## Screenshots

```
┌─────────────────────────────────┐
│ ♫ SyncBeats          📌 ─ ✕    │
├─────────────────────────────────┤
│  Room: ABC123         👤 3      │
├─────────────────────────────────┤
│  ┌─────────────────────────┐   │
│  │    🎵 Video Player      │   │
│  └─────────────────────────┘   │
│  Now Playing: Song Title        │
│  Added by: Username             │
│       ⏮  ▶  ⏭                 │
│  ═══════════●────────────       │
├─────────────────────────────────┤
│  [Paste YouTube URL...]    [+]  │
├─────────────────────────────────┤
│  Queue (3 songs)                │
│  ▸ 1. Current Song              │
│    2. Next Song                 │
│    3. Another Song              │
└─────────────────────────────────┘
```

## Setup

### Prerequisites

- Node.js 18+ installed
- npm (comes with Node.js)

### 1. Install Dependencies

```bash
# In the main folder (for Electron app)
cd sync-music-app
npm install

# In the server folder
cd server
npm install
```

### 2. Start the Server

The server handles room management and syncing between users.

```bash
cd server
npm start
```

You should see: `🎵 SyncBeats server running on port 3000`

### 3. Start the Desktop App

In a new terminal:

```bash
cd sync-music-app
npm start
```

This opens the Electron app!

## How to Use

### Creating a Room (Host)

1. Enter your name
2. Click "Create Room"
3. Share the 6-character room code with friends (click 📋 to copy)

### Joining a Room

1. Enter your name
2. Enter the room code
3. Click "Join"

### Adding Songs

1. Copy a YouTube URL (like `https://www.youtube.com/watch?v=dQw4w9WgXcQ`)
2. Paste it in the URL field
3. Click the + button

### Host Controls

- **Play/Pause** - Toggle playback for everyone
- **Skip** - Move to next/previous song
- **Reorder** - Drag songs in the queue to reorder
- **Remove** - Click ✕ on any song to remove it

## Deploying the Server

For friends to connect over the internet (not just local network), you need to deploy the server.

### Option 1: Railway (Free tier available)

1. Create account at [railway.app](https://railway.app)
2. Connect your GitHub repo
3. Deploy the `server` folder
4. Get your server URL (like `https://your-app.railway.app`)

### Option 2: Render (Free tier available)

1. Create account at [render.com](https://render.com)
2. Create a new "Web Service"
3. Point to the `server` folder
4. Get your server URL

### Update the App

After deploying, update `SERVER_URL` in `client/js/app.js`:

```javascript
const SERVER_URL = 'https://your-server-url.railway.app';
```

## Building the Desktop App

To create distributable installers:

```bash
npm install electron-builder --save-dev
```

Add to `package.json`:

```json
{
  "scripts": {
    "build": "electron-builder"
  },
  "build": {
    "appId": "com.syncbeats.app",
    "productName": "SyncBeats",
    "win": {
      "target": "nsis"
    },
    "mac": {
      "target": "dmg"
    },
    "linux": {
      "target": "AppImage"
    }
  }
}
```

Then run:

```bash
npm run build
```

## Troubleshooting

### "Connection failed"

- Make sure the server is running
- Check that `SERVER_URL` is correct
- If on different networks, server needs to be deployed online

### Video not playing

- YouTube embeds require internet connection
- Some videos may be blocked from embedding by the uploader

### Out of sync

- Click the video area to request a sync
- Host can pause and play to force everyone to sync

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript
- **Desktop**: Electron
- **Backend**: Node.js, Express, Socket.io
- **Video**: YouTube IFrame API

## License

MIT - Feel free to modify and share!
