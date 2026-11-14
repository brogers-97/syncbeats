const { app, BrowserWindow, ipcMain, screen, nativeTheme } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');

let mainWindow;
let audioServer = null;
let currentAudioPath = null;

// Window sizes for each view (the renderer asks for one of these by name)
const WINDOW_WIDTH = 400;
const WINDOW_MODES = {
  landing: { width: WINDOW_WIDTH, height: 490 },                  // Home / room entry
  full:    { width: WINDOW_WIDTH, height: 580, minHeight: 440 },  // Expanded player (you can drag it taller)
  compact: { width: WINDOW_WIDTH, height: 84 },                   // Slim bar for gaming
  mini:    { width: 68, height: 68 }                              // Tiny icon
};
const WINDOW_BACKGROUND = '#0a1128';

// How the window background is drawn. Change this one word and restart to try another:
//   'acrylic' - real frosted glass: Windows blurs whatever is behind the window.
//               Windows 11 only, and Windows swaps the blur for flat dark gray whenever
//               SyncBeats is not the window you last clicked (for example, while in a game).
//   'clear'   - see-through tint with rounded corners, but no blur. Stays see-through
//               over a game. The player can't be dragged taller in this style.
//   'solid'   - painted background, nothing shows through. Works everywhere.
const WINDOW_STYLE = 'acrylic';

// Acrylic needs Windows 11 22H2 (build 22621) or newer; anything else gets 'solid'
function resolveWindowStyle() {
  if (WINDOW_STYLE !== 'acrylic') return WINDOW_STYLE;
  const build = Number(os.release().split('.')[2]);
  return process.platform === 'win32' && build >= 22621 ? 'acrylic' : 'solid';
}
const windowStyle = resolveWindowStyle();

// BrowserWindow settings for the chosen style
function windowStyleOptions() {
  if (windowStyle === 'acrylic') {
    nativeTheme.themeSource = 'dark'; // dark glass, even if Windows is in light mode
    return { transparent: false, backgroundMaterial: 'acrylic' };
  }
  if (windowStyle === 'clear') {
    return { transparent: true, backgroundColor: '#00000000' };
  }
  return { transparent: false, backgroundColor: WINDOW_BACKGROUND };
}

let windowMode = 'landing';
let fullHeight = WINDOW_MODES.full.height; // remembers how tall you dragged the player
let dragOrigin = null;                     // window position when a mini-icon drag started

// Audio server port
const AUDIO_SERVER_PORT = 45678;

// Get user data directory for yt-dlp (writable location)
function getYtDlpDir() {
  const ytdlpDir = path.join(app.getPath('userData'), 'yt-dlp');
  if (!fs.existsSync(ytdlpDir)) {
    fs.mkdirSync(ytdlpDir, { recursive: true });
  }
  return ytdlpDir;
}

// Get the path to yt-dlp executable
function getYtDlpPath() {
  // Always use the copy in userData (writable location)
  return path.join(getYtDlpDir(), 'yt-dlp.exe');
}

// Get the bundled yt-dlp path (read-only, ships with app)
function getBundledYtDlpPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'yt-dlp.exe');
  } else {
    return path.join(__dirname, 'resources', 'yt-dlp.exe');
  }
}

// Ensure yt-dlp exists in writable location — always use the bundled version
function ensureYtDlpExists() {
  const ytdlpPath = getYtDlpPath();
  const bundledPath = getBundledYtDlpPath();

  try {
    fs.copyFileSync(bundledPath, ytdlpPath);
  } catch (err) {
    console.log('   ❌ Failed to copy yt-dlp:', err.message);
    return bundledPath;
  }

  return ytdlpPath;
}


// Get temp directory for audio files
function getTempAudioDir() {
  const tempDir = path.join(os.tmpdir(), 'syncbeats-audio');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

// Clean up old audio files
function cleanupOldAudio() {
  const tempDir = getTempAudioDir();
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      // Delete files older than 1 hour
      const stats = fs.statSync(filePath);
      const age = Date.now() - stats.mtimeMs;
      if (age > 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Cleaned up old audio: ${file}`);
      }
    }
  } catch (err) {
    console.log('Cleanup error:', err.message);
  }
}

// Start local audio server
function startAudioServer() {
  if (audioServer) return;

  audioServer = http.createServer((req, res) => {
    // Parse the video ID from the URL
    const videoId = req.url.replace('/', '').split('?')[0];
    const audioPath = path.join(getTempAudioDir(), `${videoId}.webm`);

    if (!fs.existsSync(audioPath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const stat = fs.statSync(audioPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Handle range requests for seeking
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const file = fs.createReadStream(audioPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'audio/webm',
        'Access-Control-Allow-Origin': '*'
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'audio/webm',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(audioPath).pipe(res);
    }
  });

  audioServer.listen(AUDIO_SERVER_PORT, '127.0.0.1', () => {
    console.log(`🔊 Audio server started`);
  });

  audioServer.on('error', (err) => {
    console.log('Audio server error:', err.message);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_MODES.landing.width,
    height: WINDOW_MODES.landing.height,
    maxWidth: WINDOW_WIDTH,
    frame: false,
    ...windowStyleOptions(),
    alwaysOnTop: true,
    resizable: false,       // only the expanded player can be resized (see applyWindowMode)
    maximizable: false,
    fullscreenable: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'client', 'preload.js')
    }
  });

  // The page reads ?window=... to pick the matching background in styles.css
  mainWindow.loadFile('client/index.html', { query: { window: windowStyle } });

  // Uncomment for debugging:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  startAudioServer();
  cleanupOldAudio();
  ensureYtDlpExists();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('quit', () => {
  if (audioServer) {
    audioServer.close();
  }
});

// Handle window controls from renderer
ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.on('close-window', () => {
  mainWindow.close();
});

// Toggle always on top
ipcMain.on('toggle-always-on-top', (event) => {
  const isOnTop = mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(!isOnTop);
  event.reply('always-on-top-changed', !isOnTop);
});

// ========================================
// Window size switching
// ========================================

// Keep a window rectangle inside the screen it is on
function fitOnScreen(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width));
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height));
  return { x, y, width: bounds.width, height: bounds.height };
}

// Resize the window for one of WINDOW_MODES (landing / full / compact / mini)
function applyWindowMode(mode) {
  if (!mainWindow || !Object.prototype.hasOwnProperty.call(WINDOW_MODES, mode)) return;
  const size = WINDOW_MODES[mode];

  // Remember how tall the player was dragged, so it comes back the same size
  if (windowMode === 'full') {
    fullHeight = mainWindow.getSize()[1];
  }
  windowMode = mode;

  // A see-through ('clear') window must stay fixed-size or Windows stops drawing it see-through
  const fixedSize = windowStyle === 'clear';
  const resizable = mode === 'full' && !fixedSize;
  const height = mode === 'full' ? Math.max(fullHeight, size.minHeight) : size.height;
  const [x, y] = mainWindow.getPosition();

  if (!fixedSize) mainWindow.setResizable(true); // a fixed-size window can refuse to change size
  mainWindow.setMinimumSize(size.width, mode === 'full' ? size.minHeight : size.height);
  mainWindow.setBounds(fitOnScreen({ x, y, width: size.width, height }));
  if (!fixedSize) mainWindow.setResizable(resizable);
}

ipcMain.on('set-window-mode', (event, mode) => {
  applyWindowMode(mode);
});

// Dragging the mini icon: the renderer reports how far the mouse has moved
ipcMain.on('window-drag-start', () => {
  const [x, y] = mainWindow.getPosition();
  dragOrigin = { x, y };
});

ipcMain.on('window-drag-move', (event, dx, dy) => {
  if (!dragOrigin || !Number.isFinite(dx) || !Number.isFinite(dy)) return;

  // Pass the size every time so the window can't creep bigger while it moves
  const size = WINDOW_MODES[windowMode];
  mainWindow.setBounds({
    x: Math.round(dragOrigin.x + dx),
    y: Math.round(dragOrigin.y + dy),
    width: size.width,
    height: windowMode === 'full' ? mainWindow.getSize()[1] : size.height
  });
});

ipcMain.on('window-drag-end', () => {
  dragOrigin = null;
});

// ========================================
// yt-dlp handlers (runs locally on each client)
// ========================================

// Search for songs
ipcMain.handle('yt-search', async (event, query) => {
  const ytdlpPath = getYtDlpPath();

  return new Promise((resolve, reject) => {
    const ytdlp = spawn(ytdlpPath, [
      `ytsearch10:${query}`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
    ]);

    let stdout = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const videos = stdout.trim().split('\n').map(line => {
            const item = JSON.parse(line);
            return {
              type: 'video',
              videoId: item.id,
              title: item.title || 'Unknown Title',
              author: item.channel || item.uploader || 'Unknown',
              lengthSeconds: item.duration || 0,
              videoThumbnails: [{ url: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg` }]
            };
          });
          resolve(videos);
        } catch (e) {
          reject(new Error('Failed to parse results'));
        }
      } else {
        reject(new Error('Search failed'));
      }
    });

    ytdlp.on('error', (err) => {
      reject(err);
    });
  });
});

// Get audio stream URL - now downloads the file and serves it locally
ipcMain.handle('yt-stream', async (event, videoId) => {
  const ytdlpPath = getYtDlpPath();
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const audioPath = path.join(getTempAudioDir(), `${videoId}.webm`);

  // Check if we already have this audio cached
  if (fs.existsSync(audioPath)) {
    const stats = fs.statSync(audioPath);
    const age = Date.now() - stats.mtimeMs;
    // Use cache if less than 30 minutes old
    if (age < 30 * 60 * 1000) {
      return `http://127.0.0.1:${AUDIO_SERVER_PORT}/${videoId}`;
    }
  }

  return new Promise((resolve, reject) => {
    const ytdlp = spawn(ytdlpPath, [
      '-f', 'bestaudio[ext=webm]/bestaudio',
      '-o', audioPath,
      '--no-playlist',
      '--no-warnings',
      ytUrl
    ]);

    let stderr = '';

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.stdout.on('data', () => {});

    ytdlp.on('close', (code) => {
      if (code === 0 && fs.existsSync(audioPath)) {
        resolve(`http://127.0.0.1:${AUDIO_SERVER_PORT}/${videoId}`);
      } else {
        console.error('yt-dlp stderr:', stderr);
        reject(new Error(`Failed to download audio (exit ${code}): ${stderr.trim().split('\n').pop()}`));
      }
    });

    ytdlp.on('error', (err) => {
      reject(err);
    });
  });
});

// Get related videos for auto-queue feature
ipcMain.handle('yt-related', async (event, videoId) => {
  const ytdlpPath = getYtDlpPath();
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return new Promise((resolve, reject) => {
    // Get full video info which includes related videos
    const ytdlp = spawn(ytdlpPath, [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--flat-playlist',
      ytUrl
    ]);

    let stdout = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        try {
          const videoInfo = JSON.parse(stdout.trim());

          // Try to get related videos from various possible fields
          let related = [];

          // Check for related videos in the response
          if (videoInfo.related_videos) {
            related = videoInfo.related_videos;
          } else if (videoInfo.entries) {
            related = videoInfo.entries;
          }

          // If no related videos found, fall back to searching by title/artist
          if (related.length === 0) {
            resolve({ fallbackSearch: videoInfo.title || videoInfo.fulltitle });
            return;
          }

          // Filter and format related videos
          const MAX_LENGTH = 600; // 10 minutes max
          const videos = related
            .filter(item => item.id && item.id !== videoId)
            .filter(item => !item.duration || item.duration <= MAX_LENGTH)
            .slice(0, 10)
            .map(item => ({
              type: 'video',
              videoId: item.id,
              title: item.title || 'Unknown Title',
              author: item.channel || item.uploader || 'Unknown',
              lengthSeconds: item.duration || 0,
              videoThumbnails: [{ url: item.thumbnail || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg` }]
            }));

          resolve({ videos });
        } catch (e) {
          reject(new Error('Failed to parse related videos'));
        }
      } else {
        reject(new Error('Failed to get related videos'));
      }
    });

    ytdlp.on('error', (err) => {
      reject(err);
    });
  });
});