const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');

let mainWindow;
let audioServer = null;
let currentAudioPath = null;

// Window sizes
const WINDOW_WIDTH = 340;
const LANDING_HEIGHT = 523;    // Full size for join/create screen
const COLLAPSED_HEIGHT = 130;  // Tiny widget mode
const EXPANDED_HEIGHT = 523;   // Expanded with queue/search

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

// Ensure yt-dlp exists in writable location
function ensureYtDlpExists() {
  const ytdlpPath = getYtDlpPath();
  const bundledPath = getBundledYtDlpPath();
  
  // If yt-dlp doesn't exist in userData, copy it from bundled resources
  if (!fs.existsSync(ytdlpPath)) {
    console.log('📦 Copying yt-dlp to user data folder...');
    try {
      fs.copyFileSync(bundledPath, ytdlpPath);
      console.log('   ✅ yt-dlp copied successfully');
    } catch (err) {
      console.log('   ❌ Failed to copy yt-dlp:', err.message);
      // Fallback to bundled path if copy fails
      return bundledPath;
    }
  }
  
  return ytdlpPath;
}

// Update yt-dlp on startup
async function updateYtDlp() {
  const ytdlpPath = ensureYtDlpExists();
  
  console.log('🔄 Checking for yt-dlp updates...');
  
  return new Promise((resolve) => {
    const ytdlp = spawn(ytdlpPath, ['-U']);
    
    let output = '';
    
    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
      const line = data.toString().trim();
      if (line) console.log('   ' + line);
    });
    
    ytdlp.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    ytdlp.on('close', (code) => {
      if (output.includes('Updated')) {
        console.log('   ✅ yt-dlp updated successfully!');
      } else if (output.includes('up to date') || output.includes('up-to-date')) {
        console.log('   ✅ yt-dlp is already up to date');
      } else {
        console.log('   ℹ️ yt-dlp update check complete');
      }
      resolve();
    });
    
    ytdlp.on('error', (err) => {
      console.log('   ⚠️ Could not check for updates:', err.message);
      resolve(); // Don't block app startup on update failure
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      console.log('   ⚠️ Update check timed out');
      resolve();
    }, 30000);
  });
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
    width: WINDOW_WIDTH,
    height: LANDING_HEIGHT,
    minWidth: 300,
    minHeight: COLLAPSED_HEIGHT,
    maxWidth: 400,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('client/index.html');

  // Uncomment for debugging:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  startAudioServer();
  cleanupOldAudio();
  await updateYtDlp();
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

// Entered a room - start expanded so user can add songs
ipcMain.on('entered-room', () => {
  mainWindow.setMinimumSize(300, COLLAPSED_HEIGHT);
  mainWindow.setSize(WINDOW_WIDTH, EXPANDED_HEIGHT);
});

// Toggle between collapsed widget and expanded panel
ipcMain.on('toggle-expanded', (event, isExpanded) => {
  const newHeight = isExpanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
  
  mainWindow.setMinimumSize(300, COLLAPSED_HEIGHT);
  mainWindow.setSize(WINDOW_WIDTH, newHeight);
});

// Left room - back to landing screen
ipcMain.on('show-landing', () => {
  mainWindow.setMinimumSize(300, LANDING_HEIGHT);
  mainWindow.setSize(WINDOW_WIDTH, LANDING_HEIGHT);
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
      '--no-warnings'
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
    
    ytdlp.stdout.on('data', (data) => {
      // Progress output (optional - can remove if too verbose)
    });
    
    ytdlp.on('close', (code) => {
      if (code === 0 && fs.existsSync(audioPath)) {
        resolve(`http://127.0.0.1:${AUDIO_SERVER_PORT}/${videoId}`);
      } else {
        reject(new Error('Failed to download audio'));
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