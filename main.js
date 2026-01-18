const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;

// Window sizes
const WINDOW_WIDTH = 340;
const LANDING_HEIGHT = 523;    // Full size for join/create screen
const COLLAPSED_HEIGHT = 130;  // Tiny widget mode
const EXPANDED_HEIGHT = 523;   // Expanded with queue/search

// Get the path to bundled yt-dlp
function getYtDlpPath() {
  if (app.isPackaged) {
    // In production, it's in resources folder
    return path.join(process.resourcesPath, 'yt-dlp.exe');
  } else {
    // In development, it's in the project resources folder
    return path.join(__dirname, 'resources', 'yt-dlp.exe');
  }
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('client/index.html');
  
  // Log whenever window size changes
  mainWindow.on('resize', () => {
    const size = mainWindow.getSize();
    console.log(`📐 Window resized to: ${size[0]} x ${size[1]}`);
  });

  // Uncomment for debugging:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

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
  console.log('📥 IPC: entered-room - resizing to expanded');
  mainWindow.setMinimumSize(300, COLLAPSED_HEIGHT);
  mainWindow.setSize(WINDOW_WIDTH, EXPANDED_HEIGHT);
});

// Toggle between collapsed widget and expanded panel
ipcMain.on('toggle-expanded', (event, isExpanded) => {
  console.log('📥 IPC: toggle-expanded -', isExpanded ? 'EXPANDED' : 'COLLAPSED');
  const newHeight = isExpanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
  
  mainWindow.setMinimumSize(300, COLLAPSED_HEIGHT);
  mainWindow.setSize(WINDOW_WIDTH, newHeight);
});

// Left room - back to landing screen
ipcMain.on('show-landing', () => {
  console.log('📥 IPC: show-landing');
  mainWindow.setMinimumSize(300, LANDING_HEIGHT);
  mainWindow.setSize(WINDOW_WIDTH, LANDING_HEIGHT);
});

// ========================================
// yt-dlp handlers (runs locally on each client)
// ========================================

// Search for songs
ipcMain.handle('yt-search', async (event, query) => {
  console.log(`🔍 SEARCH: "${query}"`);
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
          console.log(`   ✅ Found ${videos.length} results`);
          resolve(videos);
        } catch (e) {
          console.log('   ❌ Parse error:', e.message);
          reject(new Error('Failed to parse results'));
        }
      } else {
        console.log('   ❌ yt-dlp error:', stderr);
        reject(new Error('Search failed'));
      }
    });
    
    ytdlp.on('error', (err) => {
      console.log('   ❌ Spawn error:', err.message);
      reject(err);
    });
  });
});

// Get audio stream URL
ipcMain.handle('yt-stream', async (event, videoId) => {
  console.log(`🎵 STREAM: ${videoId}`);
  const ytdlpPath = getYtDlpPath();
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  return new Promise((resolve, reject) => {
    const ytdlp = spawn(ytdlpPath, [
      '-f', 'bestaudio',
      '-g',
      '--no-playlist',
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
        console.log('   ✅ Got audio URL');
        resolve(stdout.trim());
      } else {
        console.log('   ❌ yt-dlp error:', stderr);
        reject(new Error('Failed to get stream URL'));
      }
    });
    
    ytdlp.on('error', (err) => {
      console.log('   ❌ Spawn error:', err.message);
      reject(err);
    });
  });
});