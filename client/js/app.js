// ========================================
// SyncBeats - Main Application
// ========================================

// Check if running in Electron
const isElectron = typeof require !== 'undefined';
let ipcRenderer = null;

if (isElectron) {
  ipcRenderer = require('electron').ipcRenderer;
}

// ========================================
// Configuration
// ========================================

// IMPORTANT: Change this to your server URL when deployed
const SERVER_URL = 'https://syncbeats-server.onrender.com';

// ========================================
// State
// ========================================

let socket = null;
let player = null;
let isHost = false;
let roomCode = null;
let username = '';
let queue = [];
let currentIndex = 0;
let isPlaying = false;
let users = [];
let syncInterval = null;
let playerReady = false;

// Reconnection state
let wasInRoom = false;
let lastRoomCode = null;
let lastUsername = null;
let lastIsHost = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

// Auto-queue state
let autoQueueEnabled = false;
let isAutoQueueing = false;
let repeatEnabled = false;
const AUTO_QUEUE_THRESHOLD = 2; // Trigger when 2 or fewer songs remaining
const AUTO_QUEUE_ADD_COUNT = 5; // Add 5 songs at a time

// ========================================
// DOM Elements
// ========================================

const elements = {
  // Screens
  landingScreen: document.getElementById('landingScreen'),
  roomScreen: document.getElementById('roomScreen'),
  
  // Landing
  usernameInput: document.getElementById('usernameInput'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  serverStatus: document.getElementById('serverStatus'),
  
  // Mini player
  miniPlayer: document.getElementById('miniPlayer'),
  miniAlbumArt: document.getElementById('miniAlbumArt'),
  currentSongTitle: document.getElementById('currentSongTitle'),
  currentSongAddedBy: document.getElementById('currentSongAddedBy'),
  prevBtn: document.getElementById('prevBtn'),
  playPauseBtn: document.getElementById('playPauseBtn'),
  nextBtn: document.getElementById('nextBtn'),
  progressBar: document.getElementById('progressBar'),
  progressFill: document.getElementById('progressFill'),
  
  // Expand/collapse
  expandBtn: document.getElementById('expandBtn'),
  expandedPanel: document.getElementById('expandedPanel'),
  
  // Expanded panel contents
  displayRoomCode: document.getElementById('displayRoomCode'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  usersCount: document.getElementById('usersCount'),
  volumeSlider: document.getElementById('volumeSlider'),
  volumeIcon: document.getElementById('volumeIcon'),
  
  // Queue
  songSearchInput: document.getElementById('songSearchInput'),
  searchSongBtn: document.getElementById('searchSongBtn'),
  searchResults: document.getElementById('searchResults'),
  queueList: document.getElementById('queueList'),
  queueCount: document.getElementById('queueCount'),
  autoQueueBtn: document.getElementById('autoQueueBtn'),
  repeatBtn: document.getElementById('repeatBtn'),
  
  // Other
  leaveRoomBtn: document.getElementById('leaveRoomBtn'),
  toastContainer: document.getElementById('toastContainer'),
  usersModal: document.getElementById('usersModal'),
  usersList: document.getElementById('usersList'),
  closeUsersModal: document.getElementById('closeUsersModal'),
  
  // Title bar
  pinBtn: document.getElementById('pinBtn'),
  minBtn: document.getElementById('minBtn'),
  closeBtn: document.getElementById('closeBtn')
};

// Track expanded state
let isExpanded = false;

// ========================================
// Initialization
// ========================================

function init() {
  setupTitleBar();
  setupEventListeners();
  setupExpandCollapse();
  loadAudioPlayer();
  connectToServer();
}

function setupExpandCollapse() {
  elements.expandBtn.addEventListener('click', toggleExpanded);
}

function toggleExpanded() {
  isExpanded = !isExpanded;
  elements.expandBtn.classList.toggle('expanded', isExpanded);
  elements.expandedPanel.classList.toggle('active', isExpanded);
  
  // Notify Electron to resize window
  if (isElectron && ipcRenderer) {
    ipcRenderer.send('toggle-expanded', isExpanded);
  }
}

function setupTitleBar() {
  if (!isElectron) return;
  
  elements.pinBtn.addEventListener('click', () => {
    ipcRenderer.send('toggle-always-on-top');
  });
  
  elements.minBtn.addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
  });
  
  elements.closeBtn.addEventListener('click', () => {
    ipcRenderer.send('close-window');
  });
  
  ipcRenderer.on('always-on-top-changed', (event, isOnTop) => {
    elements.pinBtn.classList.toggle('active', isOnTop);
  });
  
  // Set initial pin state
  elements.pinBtn.classList.add('active');
}

function setupEventListeners() {
  // Landing screen
  elements.createRoomBtn.addEventListener('click', createRoom);
  elements.joinRoomBtn.addEventListener('click', joinRoom);
  
  elements.usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') elements.createRoomBtn.click();
  });
  
  elements.roomCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') elements.joinRoomBtn.click();
  });
  
  // Room screen
  elements.copyCodeBtn.addEventListener('click', copyRoomCode);
  elements.usersCount.addEventListener('click', showUsersModal);
  elements.closeUsersModal.addEventListener('click', hideUsersModal);
  
  elements.searchSongBtn.addEventListener('click', searchSongs);
  elements.songSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchSongs();
  });
  
  // Close search results when clicking outside
  document.addEventListener('click', (e) => {
    if (!elements.searchResults.contains(e.target) && 
        !elements.songSearchInput.contains(e.target) &&
        !elements.searchSongBtn.contains(e.target)) {
      elements.searchResults.classList.remove('active');
    }
  });
  
  elements.playPauseBtn.addEventListener('click', togglePlayPause);
  elements.prevBtn.addEventListener('click', prevSong);
  elements.nextBtn.addEventListener('click', nextSong);
  
  elements.progressBar.addEventListener('click', seekTo);
  
  // Volume control
  elements.volumeSlider.addEventListener('input', (e) => {
    const volume = e.target.value / 100;
    if (player) {
      player.volume = volume;
    }
    updateVolumeIcon(volume);
  });
  
  elements.volumeIcon.addEventListener('click', () => {
    if (player) {
      if (player.volume > 0) {
        player.dataset.previousVolume = player.volume;
        player.volume = 0;
        elements.volumeSlider.value = 0;
        updateVolumeIcon(0);
      } else {
        const prevVolume = player.dataset.previousVolume || 0.5;
        player.volume = prevVolume;
        elements.volumeSlider.value = prevVolume * 100;
        updateVolumeIcon(prevVolume);
      }
    }
  });
  
  elements.leaveRoomBtn.addEventListener('click', leaveRoom);
  
  // Auto-queue button (host only)
  if (elements.autoQueueBtn) {
    elements.autoQueueBtn.addEventListener('click', toggleAutoQueue);
  }
  
  // Repeat button (host only)
  if (elements.repeatBtn) {
    elements.repeatBtn.addEventListener('click', toggleRepeat);
  }
  
  // Close modal on backdrop click
  elements.usersModal.addEventListener('click', (e) => {
    if (e.target === elements.usersModal) hideUsersModal();
  });
}

// ========================================
// HTML5 Audio Player
// ========================================

function loadAudioPlayer() {
  player = document.getElementById('audioPlayer');
  
  // Set initial volume
  player.volume = 0.5;
  
  player.addEventListener('play', () => {
    isPlaying = true;
    updatePlayPauseButton();
    startProgressUpdate();
  });
  
  player.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayPauseButton();
    stopProgressUpdate();
  });
  
  player.addEventListener('ended', () => {
    if (isHost) {
      // Check if we're at the last song and repeat is enabled
      if (repeatEnabled && currentIndex >= queue.length - 1) {
        // Go back to first song
        socket.emit('play-song', 0);
      } else {
        socket.emit('song-ended');
      }
    }
  });
  
  player.addEventListener('error', (e) => {
    showToast('Error playing track', 'error');
    if (isHost) {
      setTimeout(() => socket.emit('next-song'), 2000);
    }
  });
  
  playerReady = true;
}

// ========================================
// Socket Connection
// ========================================

function connectToServer() {
  updateServerStatus('connecting');
  
  // Load socket.io from CDN if not in Electron
  if (!isElectron) {
    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
    script.onload = initSocket;
    document.head.appendChild(script);
  } else {
    // In Electron, socket.io-client is installed via npm
    const io = require('socket.io-client');
    socket = io(SERVER_URL);
    setupSocketListeners();
  }
}

function initSocket() {
  socket = io(SERVER_URL);
  setupSocketListeners();
}

function setupSocketListeners() {
  socket.on('connect', () => {
    console.log('🟢 Connected to server');
    updateServerStatus('connected');
    
    // If we were in a room, try to rejoin
    if (wasInRoom && lastRoomCode && lastUsername) {
      attemptRejoin();
    }
  });
  
  // Keep server awake - ping every 5 minutes
  setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('ping-keep-alive');
    }
  }, 5 * 60 * 1000);
  
  socket.on('disconnect', (reason) => {
    console.log('🔴 Disconnected:', reason);
    updateServerStatus('disconnected');
    
    // Remember we were in a room so we can rejoin
    if (roomCode) {
      wasInRoom = true;
      lastRoomCode = roomCode;
      lastUsername = username;
      lastIsHost = isHost;
    }
    
    // Show reconnecting message
    if (wasInRoom) {
      showToast('Connection lost. Reconnecting...', 'error');
    }
  });
  
  socket.on('connect_error', (err) => {
    console.log('❌ Connection error:', err.message);
    updateServerStatus('error');
  });
  
  // Room events
  socket.on('room-created', handleRoomCreated);
  socket.on('room-joined', handleRoomJoined);
  socket.on('room-closed', handleRoomClosed);
  socket.on('error', handleError);
  
  // User events
  socket.on('user-joined', handleUserJoined);
  socket.on('user-left', handleUserLeft);
  
  // Queue events
  socket.on('queue-updated', handleQueueUpdated);
  
  // Playback events
  socket.on('playback-state', handlePlaybackState);
  socket.on('song-changed', handleSongChanged);
  socket.on('time-sync', handleTimeSync);
  socket.on('full-sync', handleFullSync);
  
  // Leave event
  socket.on('left-room', handleLeftRoom);
  
  // Rejoin failed (room no longer exists)
  socket.on('rejoin-failed', handleRejoinFailed);
}

function attemptRejoin() {
  reconnectAttempts++;
  
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    handleRejoinFailed({ message: 'Could not rejoin room after multiple attempts.' });
    return;
  }
  
  // Try to rejoin the room
  if (lastIsHost) {
    handleRejoinFailed({ message: 'Room closed because you (the host) disconnected.' });
  } else {
    socket.emit('join-room', { roomCode: lastRoomCode, username: lastUsername });
  }
}

function handleRejoinFailed(data) {
  showToast(data.message || 'Room no longer exists', 'error');
  
  // Reset reconnection state
  wasInRoom = false;
  lastRoomCode = null;
  lastUsername = null;
  lastIsHost = false;
  reconnectAttempts = 0;
  
  // Go back to landing
  resetToLanding();
}

function updateServerStatus(status) {
  elements.serverStatus.className = 'server-status ' + status;
  const statusText = elements.serverStatus.querySelector('.status-text');
  
  switch (status) {
    case 'connecting':
      statusText.textContent = 'Connecting...';
      break;
    case 'connected':
      statusText.textContent = 'Connected';
      break;
    case 'disconnected':
      statusText.textContent = 'Reconnecting...';
      break;
    case 'error':
      statusText.textContent = 'Connection failed';
      break;
  }
}

// ========================================
// Room Management
// ========================================

function createRoom() {
  username = elements.usernameInput.value.trim();
  if (!username) {
    showToast('Please enter your name', 'error');
    elements.usernameInput.focus();
    return;
  }
  
  socket.emit('create-room', username);
}

function joinRoom() {
  username = elements.usernameInput.value.trim();
  const code = elements.roomCodeInput.value.trim().toUpperCase();
  
  if (!username) {
    showToast('Please enter your name', 'error');
    elements.usernameInput.focus();
    return;
  }
  
  if (!code || code.length !== 6) {
    showToast('Please enter a valid room code', 'error');
    elements.roomCodeInput.focus();
    return;
  }
  
  socket.emit('join-room', { roomCode: code, username });
}

function handleRoomCreated(data) {
  isHost = data.isHost;
  roomCode = data.roomCode;
  users = data.users;
  
  // Reset reconnection state
  wasInRoom = false;
  lastRoomCode = null;
  lastUsername = null;
  lastIsHost = false;
  reconnectAttempts = 0;
  
  showRoomScreen();
  showToast('Room created! Share the code with friends');
}

async function handleRoomJoined(data) {
  isHost = data.isHost;
  roomCode = data.roomCode;
  queue = data.queue;
  currentIndex = data.currentIndex;
  isPlaying = data.isPlaying;
  users = data.users;
  
  // Reset reconnection state on successful join
  wasInRoom = false;
  reconnectAttempts = 0;
  
  showRoomScreen();
  renderQueue();
  updateNowPlaying();
  
  // Sync to current playback state
  if (queue.length > 0 && queue[currentIndex] && playerReady) {
    try {
      const currentSong = queue[currentIndex];
      const audioUrl = await ipcRenderer.invoke('yt-stream', currentSong.videoId);
      
      player.src = audioUrl;
      player.load();
      
      await waitForPlayerReady();
      
      // Sync to the current time
      if (data.currentTime) {
        player.currentTime = data.currentTime;
      }
      
      if (data.isPlaying) {
        try {
          await player.play();
        } catch (e) {
          console.log('⚠️ Auto-play blocked on join');
        }
      }
    } catch (err) {
      console.log('❌ Failed to sync on join:', err.message);
    }
  }
  
  // Show appropriate message
  if (lastRoomCode === data.roomCode) {
    showToast('Reconnected to room!');
    lastRoomCode = null;
    lastUsername = null;
    lastIsHost = false;
  } else {
    showToast('Joined room!');
  }
}

function handleRoomClosed(data) {
  showToast(data.message, 'error');
  resetToLanding();
}

function handleError(data) {
  showToast(data.message, 'error');
}

function leaveRoom() {
  socket.emit('leave-room');
}

function handleLeftRoom() {
  resetToLanding();
  showToast('Left room');
}

function showRoomScreen() {
  // Hide landing, show room
  elements.landingScreen.classList.remove('active');
  elements.roomScreen.classList.add('active');
  
  // Start EXPANDED so user can search and add songs
  isExpanded = true;
  elements.expandBtn.classList.add('expanded');
  elements.expandedPanel.classList.add('active');
  
  elements.displayRoomCode.textContent = roomCode;
  updateUsersCount();
  updateControlsState();
  
  // Tell Electron we entered a room (resize window)
  if (isElectron && ipcRenderer) {
    ipcRenderer.send('entered-room');
  }
  
  // Start sync interval for host
  if (isHost) {
    syncInterval = setInterval(() => {
      if (player && player.currentTime) {
        socket.emit('sync-time', player.currentTime);
      }
    }, 2000);
  }
}

function resetToLanding() {
  // Hide room, show landing
  elements.roomScreen.classList.remove('active');
  elements.landingScreen.classList.add('active');
  
  // Reset expanded state
  isExpanded = false;
  elements.expandBtn.classList.remove('expanded');
  elements.expandedPanel.classList.remove('active');
  
  // Resize window for landing screen
  if (isElectron && ipcRenderer) {
    ipcRenderer.send('show-landing');
  }
  
  // Reset state
  isHost = false;
  roomCode = null;
  queue = [];
  currentIndex = 0;
  isPlaying = false;
  users = [];
  
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  
  // Reset player
  if (player) {
    player.pause();
    player.src = '';
  }
  
  // Reset UI
  elements.queueList.innerHTML = `
    <div class="empty-queue">
      <p>Queue is empty</p>
      <p class="hint">Paste a YouTube URL above to add songs</p>
    </div>
  `;
  elements.currentSongTitle.textContent = 'No song playing';
  elements.currentSongAddedBy.textContent = '';
  elements.progressFill.style.width = '0%';
}

function copyRoomCode() {
  navigator.clipboard.writeText(roomCode).then(() => {
    showToast('Room code copied!');
  });
}

// ========================================
// User Management
// ========================================

function handleUserJoined(data) {
  users = data.users;
  updateUsersCount();
  showToast(`${data.username} joined`);
}

function handleUserLeft(data) {
  users = data.users;
  updateUsersCount();
  showToast(`${data.username} left`);
}

function updateUsersCount() {
  elements.usersCount.querySelector('.count').textContent = users.length;
}

function showUsersModal() {
  elements.usersList.innerHTML = users.map(user => `
    <div class="user-item">
      <div class="user-avatar">${user.username.charAt(0).toUpperCase()}</div>
      <span class="user-name">${user.username}</span>
      ${user.isHost ? '<span class="user-badge">HOST</span>' : ''}
    </div>
  `).join('');
  
  elements.usersModal.classList.add('active');
}

function hideUsersModal() {
  elements.usersModal.classList.remove('active');
}

// ========================================
// Queue Management
// ========================================

// ========================================
// Song Search (via local yt-dlp)
// ========================================

async function searchSongs() {
  const query = elements.songSearchInput.value.trim();
  if (!query) {
    showToast('Please enter a song name', 'error');
    return;
  }
  
  // Show loading state
  elements.searchResults.classList.add('active');
  elements.searchResults.innerHTML = `
    <div class="search-loading">
      <span class="spinner"></span>
      Searching...
    </div>
  `;
  
  try {
    // Use IPC to call yt-dlp in main process
    const results = await ipcRenderer.invoke('yt-search', query);
    
    // Filter to only videos (not playlists/channels)
    const videos = results.filter(item => item.type === 'video');
    
    if (videos.length === 0) {
      elements.searchResults.innerHTML = `
        <div class="search-no-results">
          No results found for "${escapeHtml(query)}"
        </div>
      `;
      return;
    }
    
    // Render search results
    renderSearchResults(videos.slice(0, 10)); // Show top 10
    
  } catch (err) {
    elements.searchResults.innerHTML = `
      <div class="search-error">
        Search failed. Please try again.<br>
        <small>${err.message}</small>
      </div>
    `;
  }
}

function renderSearchResults(videos) {
  const MAX_LENGTH = 600; // 10 minutes
  
  elements.searchResults.innerHTML = videos.map(video => {
    const tooLong = video.lengthSeconds && video.lengthSeconds > MAX_LENGTH;
    return `
    <div class="search-result-item ${tooLong ? 'too-long' : ''}" 
         data-video-id="${video.videoId}" 
         data-title="${escapeHtml(video.title)}" 
         data-thumbnail="${video.videoThumbnails?.[0]?.url || ''}"
         data-length="${video.lengthSeconds || 0}">
      <img class="search-result-thumb" src="${video.videoThumbnails?.[0]?.url || ''}" alt="" loading="lazy">
      <div class="search-result-info">
        <div class="search-result-title">${escapeHtml(video.title)}</div>
        <div class="search-result-channel">${escapeHtml(video.author || 'Unknown')}</div>
      </div>
      <span class="search-result-duration ${tooLong ? 'too-long' : ''}">${formatDuration(video.lengthSeconds)}${tooLong ? ' ❌' : ''}</span>
      <button class="search-result-add" title="${tooLong ? 'Too long (10 min max)' : 'Add to queue'}" ${tooLong ? 'disabled' : ''}>+</button>
    </div>
  `}).join('');
  
  // Add click handlers
  elements.searchResults.querySelectorAll('.search-result-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.search-result-item');
      addSongFromSearch(item.dataset.videoId, item.dataset.title, item.dataset.thumbnail, parseInt(item.dataset.length));
    });
  });
  
  // Also allow clicking the whole row (if not too long)
  elements.searchResults.querySelectorAll('.search-result-item:not(.too-long)').forEach(item => {
    item.addEventListener('click', () => {
      addSongFromSearch(item.dataset.videoId, item.dataset.title, item.dataset.thumbnail, parseInt(item.dataset.length));
    });
  });
}

function addSongFromSearch(videoId, title, thumbnail, lengthSeconds) {
  // Check song length - max 10 minutes (600 seconds)
  const MAX_LENGTH = 600;
  
  if (lengthSeconds && lengthSeconds > MAX_LENGTH) {
    showToast(`Song too long! Max 10 minutes. This song is ${formatDuration(lengthSeconds)}`, 'error');
    return;
  }
  
  socket.emit('add-song', { videoId, title, thumbnail, roomCode, username });
  
  // Clear search and hide results
  elements.songSearchInput.value = '';
  elements.searchResults.classList.remove('active');
  
  showToast(`Added: ${title.substring(0, 30)}${title.length > 30 ? '...' : ''}`);
}

function formatDuration(seconds) {
  if (!seconds) return '?:??';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchVideoTitle(videoId) {
  try {
    // Use noembed service to get video info
    const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await response.json();
    return data.title || null;
  } catch {
    return null;
  }
}

function handleQueueUpdated(data) {
  queue = data.queue;
  currentIndex = data.currentIndex;
  renderQueue();
  updateNowPlaying();
  
  // Load song if this is the first one
  if (queue.length === 1 && playerReady) {
    loadCurrentSong();
  }
  
  // Check if we need to auto-queue more songs (host only)
  if (isHost && autoQueueEnabled) {
    checkAutoQueue();
  }
}

function renderQueue() {
  if (queue.length === 0) {
    elements.queueList.innerHTML = `
      <div class="empty-queue">
        <p>Queue is empty</p>
        <p class="hint">Paste a YouTube URL above to add songs</p>
      </div>
    `;
    elements.queueCount.textContent = '0 songs';
    return;
  }
  
  elements.queueCount.textContent = `${queue.length} song${queue.length !== 1 ? 's' : ''}`;
  
  elements.queueList.innerHTML = queue.map((song, index) => `
    <div class="queue-item ${index === currentIndex ? 'playing' : ''}" 
         data-id="${song.id}" 
         data-index="${index}"
         ${isHost ? 'draggable="true"' : ''}>
      ${isHost ? '<span class="drag-handle">⋮⋮</span>' : ''}
      <span class="queue-item-number">${index + 1}</span>
      <div class="queue-item-info">
        <div class="queue-item-title">${escapeHtml(song.title)}</div>
        <div class="queue-item-added">Added by ${escapeHtml(song.addedBy)}</div>
      </div>
      <div class="queue-item-actions">
        ${isHost ? `
          <button class="queue-action-btn play-btn-small" data-index="${index}" title="Play">▶</button>
          <button class="queue-action-btn delete-btn" data-id="${song.id}" title="Remove">✕</button>
        ` : ''}
      </div>
    </div>
  `).join('');
  
  // Add event listeners
  if (isHost) {
    setupQueueDragDrop();
    setupQueueActions();
  }
}

function setupQueueActions() {
  // Play buttons
  elements.queueList.querySelectorAll('.play-btn-small').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index);
      socket.emit('play-song', index);
    });
  });
  
  // Delete buttons
  elements.queueList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      socket.emit('remove-song', btn.dataset.id);
    });
  });
}

function setupQueueDragDrop() {
  const items = elements.queueList.querySelectorAll('.queue-item');
  
  items.forEach(item => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
  });
}

let draggedItem = null;

function handleDragStart(e) {
  draggedItem = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd() {
  this.classList.remove('dragging');
  draggedItem = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e) {
  e.preventDefault();
  
  if (draggedItem === this) return;
  
  const fromIndex = parseInt(draggedItem.dataset.index);
  const toIndex = parseInt(this.dataset.index);
  
  // Reorder queue
  const newQueue = [...queue];
  const [moved] = newQueue.splice(fromIndex, 1);
  newQueue.splice(toIndex, 0, moved);
  
  socket.emit('reorder-queue', newQueue);
}

// ========================================
// Playback
// ========================================

function updateNowPlaying() {
  const currentSong = queue[currentIndex];
  
  if (!currentSong) {
    elements.currentSongTitle.textContent = 'No song playing';
    elements.currentSongAddedBy.textContent = '';
    if (elements.miniAlbumArt) {
      elements.miniAlbumArt.src = '';
    }
    return;
  }
  
  elements.currentSongTitle.textContent = currentSong.title;
  elements.currentSongAddedBy.textContent = `Added by ${currentSong.addedBy}`;
}

async function loadCurrentSong() {
  // Just load, don't auto-play (used for initial load)
  await loadCurrentSongAndPlay(false);
}

async function fetchAlbumArt(title) {
  // Album art fetching - use MusicBrainz directly from client
  try {
    // Parse artist and song from title
    const parsed = parseTitle(title);
    
    const searchQuery = parsed.artist 
      ? `recording:"${parsed.song}" AND artist:"${parsed.artist}"`
      : `recording:"${parsed.song}"`;
    
    const mbUrl = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(searchQuery)}&limit=3&fmt=json`;
    
    const mbResponse = await fetch(mbUrl, {
      headers: { 'User-Agent': 'SyncBeats/1.0' }
    });
    
    if (!mbResponse.ok) return null;
    
    const mbData = await mbResponse.json();
    if (!mbData.recordings || mbData.recordings.length === 0) return null;
    
    // Try to find cover art
    for (const recording of mbData.recordings) {
      if (!recording.releases) continue;
      
      for (const release of recording.releases) {
        try {
          const caaResponse = await fetch(`https://coverartarchive.org/release/${release.id}`);
          if (caaResponse.ok) {
            const caaData = await caaResponse.json();
            const frontCover = caaData.images?.find(img => img.front) || caaData.images?.[0];
            if (frontCover) {
              return frontCover.thumbnails?.large || frontCover.thumbnails?.small || frontCover.image;
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    return null;
  } catch (err) {
    console.log('❌ Album art fetch failed:', err.message);
    return null;
  }
}

// Parse YouTube title to extract artist and song
function parseTitle(title) {
  let cleaned = title
    .replace(/\s*\(official\s*(music\s*)?video\)/gi, '')
    .replace(/\s*\[official\s*(music\s*)?video\]/gi, '')
    .replace(/\s*\(official\s*audio\)/gi, '')
    .replace(/\s*\[official\s*audio\]/gi, '')
    .replace(/\s*\(lyrics?\)/gi, '')
    .replace(/\s*\[lyrics?\]/gi, '')
    .replace(/\s*\(audio\)/gi, '')
    .replace(/\s*\[audio\]/gi, '')
    .replace(/\s*HD\s*$/i, '')
    .trim();
  
  const separators = [' - ', ' – ', ' — ', ' | '];
  
  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      const parts = cleaned.split(sep);
      if (parts.length >= 2) {
        return { artist: parts[0].trim(), song: parts.slice(1).join(sep).trim() };
      }
    }
  }
  
  return { artist: '', song: cleaned };
}

function togglePlayPause() {
  if (!isHost) return;
  
  if (isPlaying) {
    socket.emit('pause');
    player.pause();
  } else {
    socket.emit('play');
    player.play();
  }
}

function prevSong() {
  if (!isHost) return;
  socket.emit('prev-song');
}

function nextSong() {
  if (!isHost) return;
  socket.emit('next-song');
}

function handlePlaybackState(data) {
  isPlaying = data.isPlaying;
  
  if (isPlaying) {
    player.play().catch(e => {});
  } else {
    player.pause();
  }
  
  updatePlayPauseButton();
}

function handleSongChanged(data) {
  currentIndex = data.currentIndex;
  
  if (data.isPlaying !== undefined) {
    isPlaying = data.isPlaying;
  }
  
  renderQueue();
  
  // Load and play the new song
  loadCurrentSongAndPlay(isPlaying);
}

// ========================================
// FIXED: Helper function to wait for player to be ready
// ========================================
function waitForPlayerReady() {
  return new Promise((resolve) => {
    // If already ready, resolve immediately
    if (player.readyState >= 3) {
      resolve();
      return;
    }
    
    // Otherwise wait for canplaythrough event
    const onReady = () => {
      player.removeEventListener('canplaythrough', onReady);
      player.removeEventListener('canplay', onReadyFallback);
      clearTimeout(fallbackTimeout);
      resolve();
    };
    
    const onReadyFallback = () => {
      player.removeEventListener('canplaythrough', onReady);
      player.removeEventListener('canplay', onReadyFallback);
      clearTimeout(fallbackTimeout);
      resolve();
    };
    
    player.addEventListener('canplaythrough', onReady);
    player.addEventListener('canplay', onReadyFallback);
    
    // Fallback timeout - if nothing fires in 5 seconds, check readyState and proceed
    const fallbackTimeout = setTimeout(() => {
      if (player.readyState >= 2) {
        player.removeEventListener('canplaythrough', onReady);
        player.removeEventListener('canplay', onReadyFallback);
        resolve();
      }
    }, 5000);
  });
}

// ========================================
// FIXED: Separate function to load song and optionally auto-play
// ========================================
async function loadCurrentSongAndPlay(shouldPlay) {
  const currentSong = queue[currentIndex];
  if (!currentSong || !playerReady) return;
  
  // Show loading state
  showToast('Loading audio...', 'success');
  
  // Update mini album art - start with YouTube thumbnail as fallback
  if (currentSong.thumbnail && elements.miniAlbumArt) {
    elements.miniAlbumArt.src = currentSong.thumbnail;
  }
  
  // Try to fetch real album art in the background
  fetchAlbumArt(currentSong.title).then(albumArtUrl => {
    if (albumArtUrl && elements.miniAlbumArt) {
      elements.miniAlbumArt.src = albumArtUrl;
    }
  });
  
  try {
    // Get audio URL via local yt-dlp
    const audioUrl = await ipcRenderer.invoke('yt-stream', currentSong.videoId);
    
    // Remove any existing event listeners to prevent duplicates
    player.oncanplay = null;
    player.oncanplaythrough = null;
    
    // Set audio source
    player.src = audioUrl;
    player.load();
    
    updateNowPlaying();
    
    // Wait for audio to be ready, then play if needed
    if (shouldPlay) {
      await waitForPlayerReady();
      
      try {
        await player.play();
        
        // If we're not the host, request a time sync to catch up
        if (!isHost) {
          setTimeout(() => {
            socket.emit('request-sync');
          }, 500);
        }
      } catch (playError) {
        // Update UI to show paused state if autoplay was blocked
        updatePlayPauseButton();
      }
    }
    
    // Pre-download the next song in the background
    preloadNextSong();
    
  } catch (err) {
    showToast('Failed to load audio', 'error');
    
    // Auto-skip on error
    if (isHost) {
      setTimeout(() => socket.emit('next-song'), 2000);
    }
  }
}

// Pre-download the next song so it's ready instantly
async function preloadNextSong() {
  const nextIndex = currentIndex + 1;
  
  // Check if there's a next song
  if (nextIndex >= queue.length) {
    // If repeat is enabled, preload the first song
    if (repeatEnabled && queue.length > 0) {
      const firstSong = queue[0];
      try {
        await ipcRenderer.invoke('yt-stream', firstSong.videoId);
      } catch (e) {
        // Silently fail - it's just a preload
      }
    }
    return;
  }
  
  const nextSong = queue[nextIndex];
  if (!nextSong) return;
  
  try {
    // This will download and cache the audio file
    await ipcRenderer.invoke('yt-stream', nextSong.videoId);
  } catch (e) {
    // Silently fail - it's just a preload
  }
}

function handleTimeSync(data) {
  if (isHost || !player) return;
  
  const currentTime = player.currentTime;
  const diff = Math.abs(currentTime - data.currentTime);
  
  // Only sync if more than 2 seconds off
  if (diff > 2) {
    player.currentTime = data.currentTime;
  }
}

// ========================================
// FIXED: handleFullSync function
// ========================================
async function handleFullSync(data) {
  queue = data.queue;
  currentIndex = data.currentIndex;
  isPlaying = data.isPlaying;
  
  renderQueue();
  updateNowPlaying();
  
  if (queue.length > 0 && queue[currentIndex]) {
    try {
      // Get audio URL
      const currentSong = queue[currentIndex];
      const audioUrl = await ipcRenderer.invoke('yt-stream', currentSong.videoId);
      
      player.src = audioUrl;
      player.load();
      
      await waitForPlayerReady();
      
      // Sync to the current time
      if (data.currentTime) {
        player.currentTime = data.currentTime;
      }
      
      if (data.isPlaying) {
        try {
          await player.play();
        } catch (e) {
          console.log('⚠️ Auto-play blocked on sync');
        }
      }
    } catch (err) {
      console.log('❌ Full sync failed:', err.message);
    }
  }
}

function updatePlayPauseButton() {
  elements.playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
}

function updateControlsState() {
  // Only host can control playback
  elements.playPauseBtn.disabled = !isHost;
  elements.prevBtn.disabled = !isHost;
  elements.nextBtn.disabled = !isHost;
  
  if (!isHost && elements.miniPlayer) {
    elements.miniPlayer.title = 'Only the host can control playback';
  }
}

function seekTo(e) {
  if (!isHost || !player) return;
  
  const rect = elements.progressBar.getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  const duration = player.duration;
  
  if (duration) {
    player.currentTime = duration * percent;
    socket.emit('sync-time', player.currentTime);
  }
}

// Progress bar update
let progressInterval = null;

function startProgressUpdate() {
  if (progressInterval) return;
  
  progressInterval = setInterval(() => {
    if (player && player.duration) {
      const percent = (player.currentTime / player.duration) * 100;
      elements.progressFill.style.width = `${percent}%`;
    }
  }, 500);
}

function stopProgressUpdate() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// ========================================
// Auto-Queue Feature
// ========================================

function toggleAutoQueue() {
  autoQueueEnabled = !autoQueueEnabled;
  
  const btn = document.getElementById('autoQueueBtn');
  if (btn) {
    btn.classList.toggle('active', autoQueueEnabled);
    btn.title = autoQueueEnabled ? 'Auto-queue ON - Click to disable' : 'Auto-queue OFF - Click to enable';
  }
  
  showToast(autoQueueEnabled ? '🎲 Auto-queue enabled!' : 'Auto-queue disabled');
  
  // If enabled and queue is low, trigger immediately
  if (autoQueueEnabled && isHost) {
    checkAutoQueue();
  }
}

function toggleRepeat() {
  repeatEnabled = !repeatEnabled;
  
  const btn = document.getElementById('repeatBtn');
  if (btn) {
    btn.classList.toggle('active', repeatEnabled);
    btn.title = repeatEnabled ? 'Repeat ON - Click to disable' : 'Repeat OFF - Click to enable';
  }
  
  showToast(repeatEnabled ? '🔁 Repeat enabled!' : 'Repeat disabled');
}

function checkAutoQueue() {
  // Calculate remaining songs
  const remainingSongs = queue.length - currentIndex;
  
  // If we have enough songs or already auto-queueing, skip
  if (remainingSongs > AUTO_QUEUE_THRESHOLD || isAutoQueueing) {
    return;
  }
  
  // Need at least one song to base recommendations on
  if (queue.length === 0) {
    return;
  }
  
  // Trigger auto-queue
  autoQueueSongs();
}

async function autoQueueSongs() {
  if (isAutoQueueing) return;
  isAutoQueueing = true;
  
  showToast('🎲 Finding similar songs...', 'success');
  
  try {
    // Get the current or last song to base recommendations on
    const baseSong = queue[currentIndex] || queue[queue.length - 1];
    if (!baseSong) {
      isAutoQueueing = false;
      return;
    }
    
    // Parse the artist from the title (usually "Artist - Song")
    const parsed = parseTitle(baseSong.title);
    const artistName = parsed.artist || baseSong.title.split('-')[0].trim();
    
    // Search for more songs by the same artist or similar
    let videosToAdd = [];
    
    try {
      // Search for artist's other songs instead of "related videos"
      // This gives better variety
      const searchQuery = `${artistName} songs`;
      const searchResults = await ipcRenderer.invoke('yt-search', searchQuery);
      videosToAdd = searchResults;
    } catch (err) {
      isAutoQueueing = false;
      return;
    }
    
    // Filter out songs already in queue (by videoId)
    const existingIds = new Set(queue.map(s => s.videoId));
    videosToAdd = videosToAdd.filter(v => !existingIds.has(v.videoId));
    
    // Filter out songs with very similar titles (to avoid lyric/official/remix versions)
    const existingTitles = queue.map(s => normalizeTitleForComparison(s.title));
    videosToAdd = videosToAdd.filter(v => {
      const normalizedTitle = normalizeTitleForComparison(v.title);
      // Check if any existing title is too similar
      return !existingTitles.some(existing => titlesSimilar(existing, normalizedTitle));
    });
    
    // Take up to AUTO_QUEUE_ADD_COUNT songs
    videosToAdd = videosToAdd.slice(0, AUTO_QUEUE_ADD_COUNT);
    
    if (videosToAdd.length === 0) {
      showToast('No new songs found', 'error');
      isAutoQueueing = false;
      return;
    }
    
    // Add songs to queue
    for (const video of videosToAdd) {
      socket.emit('add-song', {
        videoId: video.videoId,
        title: video.title,
        thumbnail: video.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
        roomCode,
        username: 'AutoQueue'
      });
      
      // Small delay between adds to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    showToast(`🎲 Added ${videosToAdd.length} songs by ${artistName}!`);
    
  } catch (err) {
    showToast('Failed to auto-queue songs', 'error');
  }
  
  isAutoQueueing = false;
}

// Normalize title for comparison (remove common suffixes, lowercase, etc.)
function normalizeTitleForComparison(title) {
  return title
    .toLowerCase()
    .replace(/\s*\(official\s*(music\s*)?video\)/gi, '')
    .replace(/\s*\[official\s*(music\s*)?video\]/gi, '')
    .replace(/\s*\(official\s*audio\)/gi, '')
    .replace(/\s*\[official\s*audio\]/gi, '')
    .replace(/\s*\(lyrics?\)/gi, '')
    .replace(/\s*\[lyrics?\]/gi, '')
    .replace(/\s*\(audio\)/gi, '')
    .replace(/\s*\[audio\]/gi, '')
    .replace(/\s*\(visualizer\)/gi, '')
    .replace(/\s*\[visualizer\]/gi, '')
    .replace(/\s*\(lyric video\)/gi, '')
    .replace(/\s*\[lyric video\]/gi, '')
    .replace(/\s*HD\s*$/i, '')
    .replace(/\s*HQ\s*$/i, '')
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
}

// Check if two titles are similar enough to be considered the same song
function titlesSimilar(title1, title2) {
  // If either is empty, not similar
  if (!title1 || !title2) return false;
  
  // Exact match
  if (title1 === title2) return true;
  
  // One contains the other (for cases like "Song" vs "Song Remix")
  if (title1.includes(title2) || title2.includes(title1)) {
    // Check if the difference is small (like just "remix" or "live")
    const longer = title1.length > title2.length ? title1 : title2;
    const shorter = title1.length > title2.length ? title2 : title1;
    const diff = longer.replace(shorter, '').trim();
    
    // If the only difference is a common suffix, consider them similar
    const commonSuffixes = ['remix', 'live', 'acoustic', 'version', 'edit', 'mix', 'remaster', 'remastered'];
    if (commonSuffixes.some(s => diff.toLowerCase().includes(s))) {
      return true;
    }
    
    // If difference is very small, consider similar
    if (diff.length < 10) return true;
  }
  
  // Calculate simple similarity (shared words)
  const words1 = new Set(title1.split(' '));
  const words2 = new Set(title2.split(' '));
  const intersection = [...words1].filter(w => words2.has(w) && w.length > 2);
  const similarity = intersection.length / Math.max(words1.size, words2.size);
  
  // If more than 70% of words match, consider similar
  return similarity > 0.7;
}

// ========================================
// Utilities
// ========================================

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  elements.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function updateVolumeIcon(volume) {
  if (volume === 0) {
    elements.volumeIcon.textContent = '🔇';
  } else if (volume < 0.5) {
    elements.volumeIcon.textContent = '🔉';
  } else {
    elements.volumeIcon.textContent = '🔊';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========================================
// Start App
// ========================================

document.addEventListener('DOMContentLoaded', init);