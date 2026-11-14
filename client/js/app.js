// ========================================
// SyncBeats - Main Application
// ========================================

const isElectron = typeof window.electronAPI !== 'undefined';

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

// Player state
let intentionalReset = false;
let loadedSongId = null; // queue id of the song currently loaded in the player

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
  timeCurrent: document.getElementById('timeCurrent'),
  timeTotal: document.getElementById('timeTotal'),

  // Window size switching (full player / compact bar / mini icon)
  expandBtn: document.getElementById('expandBtn'),
  shrinkBtns: document.querySelectorAll('.js-shrink'),
  miniIcon: document.getElementById('miniIcon'),

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
  queueMenu: document.getElementById('queueMenu'),
  addSongBtn: document.getElementById('addSongBtn'),
  autoQueueBtn: document.getElementById('autoQueueBtn'),
  repeatBtn: document.getElementById('repeatBtn'),
  shuffleBtn: document.getElementById('shuffleBtn'),
  clearQueueBtn: document.getElementById('clearQueueBtn'),

  // Other
  leaveRoomBtn: document.getElementById('leaveRoomBtn'),
  toastContainer: document.getElementById('toastContainer'),
  usersModal: document.getElementById('usersModal'),
  usersList: document.getElementById('usersList'),
  closeUsersModal: document.getElementById('closeUsersModal'),

  // Title bar (there are two pin buttons: title bar + compact bar)
  pinBtns: document.querySelectorAll('.js-pin'),
  closeBtn: document.getElementById('closeBtn')
};

// Window size: 'full' (whole player), 'compact' (slim bar) or 'mini' (tiny icon)
let viewMode = 'full';
let viewBeforeMini = 'full';

// Builds one of the SVG icons defined at the top of index.html
function iconSvg(name, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// ========================================
// Initialization
// ========================================

function init() {
  setupTitleBar();
  setupEventListeners();
  setupViewModes();
  loadAudioPlayer();
  updateVolumeIcon(player.volume);
  updateControlsState();
  connectToServer();
}

// ========================================
// Window sizes: full player / compact bar / mini icon
// ========================================

function setupViewModes() {
  // The "-" button steps down one size: full player -> compact bar -> mini icon
  elements.shrinkBtns.forEach((btn) => {
    btn.addEventListener('click', shrinkView);
  });

  // The compact bar's expand button opens the full player again
  elements.expandBtn.addEventListener('click', () => setViewMode('full'));

  setupMiniIcon();
}

function shrinkView() {
  // The compact bar only exists inside a room, so the home screen goes straight to the icon
  if (viewMode === 'full' && roomCode) {
    setViewMode('compact');
  } else {
    setViewMode('mini');
  }
}

function setViewMode(mode) {
  // Remember where to come back to when the mini icon is clicked
  if (mode === 'mini' && viewMode !== 'mini') {
    viewBeforeMini = viewMode;
  }

  viewMode = mode;
  document.body.dataset.mode = mode; // styles.css shows the matching layout

  // Popups don't fit on the small sizes
  closeQueueMenu();
  hideUsersModal();
  elements.searchResults.classList.remove('active');

  syncWindowSize();
}

// Ask Electron to resize the window to match what is on screen
function syncWindowSize() {
  if (!isElectron) return;

  // The home screen is the full view at a shorter height
  const windowMode = (viewMode === 'full' && !roomCode) ? 'landing' : viewMode;
  window.electronAPI.setWindowMode(windowMode);
}

// The mini icon is both a button (click to reopen) and a handle (drag to move).
// A CSS drag region would swallow the click, so the dragging is done by hand.
function setupMiniIcon() {
  const icon = elements.miniIcon;
  let drag = null;
  let justDragged = false;

  icon.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    justDragged = false;
    drag = { x: e.screenX, y: e.screenY, moved: false };
    icon.setPointerCapture(e.pointerId);
    if (isElectron) window.electronAPI.dragStart();
  });

  icon.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x;
    const dy = e.screenY - drag.y;

    // A few pixels of wobble still counts as a click
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
    }
    if (drag.moved && isElectron) {
      window.electronAPI.dragMove(dx, dy);
    }
  });

  const endDrag = () => {
    if (!drag) return;
    justDragged = drag.moved;
    drag = null;
    if (isElectron) window.electronAPI.dragEnd();
  };
  icon.addEventListener('pointerup', endDrag);
  icon.addEventListener('pointercancel', endDrag);

  icon.addEventListener('click', () => {
    // Letting go after a drag also fires a click; ignore that one
    if (justDragged) {
      justDragged = false;
      return;
    }
    setViewMode(viewBeforeMini);
  });
}

function setupTitleBar() {
  if (!isElectron) return;

  elements.pinBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      window.electronAPI.toggleAlwaysOnTop();
    });
  });

  elements.closeBtn.addEventListener('click', () => {
    window.electronAPI.close();
  });

  window.electronAPI.onAlwaysOnTopChanged(setPinState);

  // The window starts pinned on top
  setPinState(true);
}

function setPinState(isOnTop) {
  elements.pinBtns.forEach((btn) => {
    btn.classList.toggle('active', isOnTop);
    btn.title = isOnTop ? 'Always on top: on' : 'Always on top: off';
  });
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

  // "+ Add Song" jumps to the search box
  elements.addSongBtn.addEventListener('click', () => {
    elements.songSearchInput.focus();
  });

  // Queue actions (host only)
  elements.shuffleBtn.addEventListener('click', shuffleUpcoming);
  elements.clearQueueBtn.addEventListener('click', clearQueue);

  // Per-song "..." menu
  elements.queueMenu.addEventListener('click', handleQueueMenuClick);
  elements.queueList.addEventListener('scroll', closeQueueMenu);
  document.addEventListener('click', (e) => {
    if (!elements.queueMenu.contains(e.target) && !e.target.closest('.queue-item-more')) {
      closeQueueMenu();
    }
  });

  // Escape closes whatever is open
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeQueueMenu();
    hideUsersModal();
    elements.searchResults.classList.remove('active');
  });

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
    if (intentionalReset) {
      intentionalReset = false;
      return;
    }
    showToast('Error playing track', 'error');
    if (isHost) {
      setTimeout(() => socket.emit('next-song'), 2000);
    }
  });

  // Keep the progress bar and time labels in step with the audio
  player.addEventListener('loadedmetadata', updateProgress);
  player.addEventListener('seeked', updateProgress);
  player.addEventListener('emptied', updateProgress);

  playerReady = true;
}

// ========================================
// Socket Connection
// ========================================

function connectToServer() {
  updateServerStatus('connecting');
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
  // styles.css colors the status dots from this attribute
  document.body.dataset.conn = status;

  let text = 'Connecting...';
  switch (status) {
    case 'connected':
      text = 'Connected';
      break;
    case 'disconnected':
      text = 'Reconnecting...';
      break;
    case 'error':
      text = 'Connection failed';
      break;
  }

  // The status shows on the home screen and in the player's bottom bar
  document.querySelectorAll('.js-status-text').forEach((el) => {
    el.textContent = text;
  });
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
      const audioUrl = await window.electronAPI.ytStream(currentSong.videoId);

      player.src = audioUrl;
      loadedSongId = currentSong.id;
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
  // Coming from the home screen opens the full player so you can search and add songs.
  // A reconnect while already in the room keeps whatever size you were using.
  const cameFromLanding = document.body.dataset.view !== 'room';
  document.body.dataset.view = 'room';

  elements.displayRoomCode.textContent = roomCode;
  updateUsersCount();
  updateControlsState();

  if (cameFromLanding) {
    setViewMode('full');
  } else {
    syncWindowSize();
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
  document.body.dataset.view = 'landing';

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

  resetPlayer();

  // Reset UI
  disarmClearQueue();
  renderQueue();
  updateNowPlaying();
  updatePlayPauseButton();
  updateControlsState();

  // The compact bar only exists inside a room, so fall back to the full window
  if (viewBeforeMini === 'compact') {
    viewBeforeMini = 'full';
  }
  setViewMode(viewMode === 'compact' ? 'full' : viewMode);
}

// Stop playback and unload the current audio
function resetPlayer() {
  if (player) {
    player.pause();
    intentionalReset = true;
    player.src = '';
  }
  loadedSongId = null;
  setProgress(0);
  updateTimeLabels();
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
  elements.usersList.innerHTML = users.map(user => {
    const escapedName = escapeHtml(user.username);
    const initial = escapeHtml(user.username.charAt(0).toUpperCase());
    return `
    <div class="user-item">
      <div class="user-avatar">${initial}</div>
      <span class="user-name">${escapedName}</span>
      ${user.isHost ? '<span class="user-badge">HOST</span>' : ''}
    </div>
  `;
  }).join('');

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
    const results = await window.electronAPI.ytSearch(query);

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
    const thumb = escapeHtml(video.videoThumbnails?.[0]?.url || '');
    return `
    <div class="search-result-item ${tooLong ? 'too-long' : ''}"
         data-video-id="${escapeHtml(video.videoId)}"
         data-title="${escapeHtml(video.title)}"
         data-thumbnail="${thumb}"
         data-author="${escapeHtml(video.author || '')}"
         data-length="${video.lengthSeconds || 0}">
      <img class="search-result-thumb" src="${thumb}" alt="" loading="lazy">
      <div class="search-result-info">
        <div class="search-result-title">${escapeHtml(video.title)}</div>
        <div class="search-result-channel">${escapeHtml(video.author || 'Unknown')}</div>
      </div>
      <span class="search-result-duration ${tooLong ? 'too-long' : ''}">${formatDuration(video.lengthSeconds)}</span>
      <button class="search-result-add" title="${tooLong ? 'Too long (10 min max)' : 'Add to queue'}" ${tooLong ? 'disabled' : ''}>${iconSvg('plus')}</button>
    </div>
  `}).join('');

  // Add click handlers
  elements.searchResults.querySelectorAll('.search-result-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.search-result-item');
      addSongFromSearch(item.dataset.videoId, item.dataset.title, item.dataset.thumbnail, parseInt(item.dataset.length), item.dataset.author);
    });
  });

  // Also allow clicking the whole row (if not too long)
  elements.searchResults.querySelectorAll('.search-result-item:not(.too-long)').forEach(item => {
    item.addEventListener('click', () => {
      addSongFromSearch(item.dataset.videoId, item.dataset.title, item.dataset.thumbnail, parseInt(item.dataset.length), item.dataset.author);
    });
  });
}

function addSongFromSearch(videoId, title, thumbnail, lengthSeconds, author) {
  // Check song length - max 10 minutes (600 seconds)
  const MAX_LENGTH = 600;

  if (lengthSeconds && lengthSeconds > MAX_LENGTH) {
    showToast(`Song too long! Max 10 minutes. This song is ${formatDuration(lengthSeconds)}`, 'error');
    return;
  }

  // author + lengthSeconds let the queue show the artist and the duration
  socket.emit('add-song', {
    videoId,
    title,
    thumbnail,
    author: author || '',
    lengthSeconds: lengthSeconds || 0,
    roomCode,
    username
  });

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

  if (queue.length === 0) {
    // Queue was emptied: unload the audio and clear the progress bar
    resetPlayer();
  } else if (queue.length === 1 && playerReady && queue[0].id !== loadedSongId) {
    // Load song if this is the first one (and it isn't the one already loaded)
    loadCurrentSong();
  }

  // Check if we need to auto-queue more songs (host only)
  if (isHost && autoQueueEnabled) {
    checkAutoQueue();
  }
}

function renderQueue() {
  // The list is rebuilt, so an open "..." menu no longer points at a real row
  closeQueueMenu();

  if (queue.length === 0) {
    elements.queueList.innerHTML = `
      <div class="empty-queue">
        <p>Queue is empty</p>
        <p class="hint">Search for a song to get started</p>
      </div>
    `;
    return;
  }

  elements.queueList.innerHTML = queue.map((song, index) => {
    const isCurrent = index === currentIndex;
    const duration = song.lengthSeconds ? formatDuration(song.lengthSeconds) : '';

    // Left cell: the wave marks the current song, otherwise drag handle + position
    const lead = isCurrent
      ? iconSvg('wave', 'queue-item-wave')
      : `${isHost ? iconSvg('grip', 'drag-handle') : ''}<span>${index + 1}</span>`;

    return `
    <div class="queue-item ${isCurrent ? 'playing' : ''}"
         data-id="${escapeHtml(song.id)}"
         data-index="${index}"
         ${isHost ? 'draggable="true"' : ''}>
      <span class="queue-item-lead">${lead}</span>
      <img class="queue-item-thumb" src="${escapeHtml(song.thumbnail || '')}" alt="" loading="lazy">
      <div class="queue-item-info">
        <div class="queue-item-title">${escapeHtml(song.title)}</div>
        <div class="queue-item-added">${escapeHtml(getSongSubtitle(song))}</div>
      </div>
      <div class="queue-item-end">
        <span class="queue-item-duration">${duration}</span>
        ${isHost ? `<button class="queue-item-more" title="More" aria-label="More">${iconSvg('dots')}</button>` : ''}
      </div>
    </div>
  `;
  }).join('');

  // Add event listeners
  if (isHost) {
    setupQueueDragDrop();
    setupQueueActions();
  }
}

function setupQueueActions() {
  // "..." opens the menu for that song (Play now / Remove)
  elements.queueList.querySelectorAll('.queue-item-more').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleQueueMenu(btn);
    });
  });
}

// Which song the open "..." menu belongs to (null when the menu is closed)
let menuSong = null;

function toggleQueueMenu(button) {
  const item = button.closest('.queue-item');
  const songId = item.dataset.id;

  // Clicking the same "..." again closes the menu
  if (menuSong && menuSong.id === songId) {
    closeQueueMenu();
    return;
  }

  menuSong = { id: songId, index: parseInt(item.dataset.index) };

  // Show it first so it can be measured, then tuck it under the button
  const menu = elements.queueMenu;
  menu.hidden = false;
  const btnRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  let top = btnRect.bottom + 4;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = btnRect.top - menuRect.height - 4; // no room below, so open upward
  }
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${Math.max(8, btnRect.right - menuRect.width)}px`;
}

function closeQueueMenu() {
  elements.queueMenu.hidden = true;
  menuSong = null;
}

function handleQueueMenuClick(e) {
  const action = e.target.closest('.menu-item')?.dataset.action;
  if (!action || !menuSong || !isHost) return;

  if (action === 'play') {
    socket.emit('play-song', menuSong.index);
  } else if (action === 'remove') {
    socket.emit('remove-song', menuSong.id);
  }

  closeQueueMenu();
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
      delete elements.miniAlbumArt.dataset.songId;
    }
    return;
  }

  elements.currentSongTitle.textContent = currentSong.title;

  // Artist, then "added by" in its own span so the compact bar can hide it
  const artist = getSongArtist(currentSong);
  const line = elements.currentSongAddedBy;
  line.textContent = artist || `Added by ${currentSong.addedBy}`;
  if (artist) {
    const addedBy = document.createElement('span');
    addedBy.className = 'added-by';
    addedBy.textContent = ` \u00b7 added by ${currentSong.addedBy}`;
    line.appendChild(addedBy);
  }

  // Show the thumbnail as soon as the song changes (covers guests who join mid-song)
  if (elements.miniAlbumArt && elements.miniAlbumArt.dataset.songId !== String(currentSong.id)) {
    elements.miniAlbumArt.dataset.songId = currentSong.id;
    elements.miniAlbumArt.src = currentSong.thumbnail || '';
  }
}

// Best guess at the artist: the "Artist - Song" part of the title,
// otherwise the YouTube channel name (newer servers send it as song.author)
function getSongArtist(song) {
  const parsed = parseTitle(song.title || '');
  if (parsed.artist) return parsed.artist;

  if (song.author) {
    return song.author.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  }
  return '';
}

// Line under a song title: "Artist · added by Name", or just "Added by Name"
function getSongSubtitle(song) {
  const artist = getSongArtist(song);
  return artist ? `${artist} · added by ${song.addedBy}` : `Added by ${song.addedBy}`;
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
    elements.miniAlbumArt.dataset.songId = currentSong.id;
  }

  // Try to fetch real album art in the background
  fetchAlbumArt(currentSong.title).then(albumArtUrl => {
    if (albumArtUrl && elements.miniAlbumArt) {
      elements.miniAlbumArt.src = albumArtUrl;
    }
  });

  try {
    // Get audio URL via local yt-dlp
    const audioUrl = await window.electronAPI.ytStream(currentSong.videoId);

    // Remove any existing event listeners to prevent duplicates
    player.oncanplay = null;
    player.oncanplaythrough = null;

    // Set audio source
    player.src = audioUrl;
    loadedSongId = currentSong.id;
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
    const msg = err.message && err.message.includes('unavailable')
      ? 'Video unavailable, skipping...'
      : 'Failed to load audio';
    showToast(msg, 'error');

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
        await window.electronAPI.ytStream(firstSong.videoId);
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
    await window.electronAPI.ytStream(nextSong.videoId);
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
      const audioUrl = await window.electronAPI.ytStream(currentSong.videoId);

      player.src = audioUrl;
      loadedSongId = currentSong.id;
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
  // Swap the icon inside the round button
  elements.playPauseBtn.querySelector('use').setAttribute('href', isPlaying ? '#i-pause' : '#i-play');
  elements.playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
}

function updateControlsState() {
  // Only host can control playback and manage the queue
  elements.playPauseBtn.disabled = !isHost;
  elements.prevBtn.disabled = !isHost;
  elements.nextBtn.disabled = !isHost;
  document.querySelectorAll('.host-only').forEach((btn) => {
    btn.disabled = !isHost;
  });

  // styles.css reads this (for example, guests don't get the seek cursor)
  document.body.dataset.host = String(isHost);

  if (elements.miniPlayer) {
    elements.miniPlayer.title = isHost ? '' : 'Only the host can control playback';
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

  progressInterval = setInterval(updateProgress, 500);
}

// Move the progress bar and refresh the "1:42 / 4:03" labels
function updateProgress() {
  if (player && player.duration) {
    setProgress((player.currentTime / player.duration) * 100);
  } else {
    setProgress(0);
  }
  updateTimeLabels();
}

function setProgress(percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  // styles.css sizes the fill and places the thumb from this variable
  elements.progressBar.style.setProperty('--progress', `${clamped}%`);
}

function updateTimeLabels() {
  const current = player && isFinite(player.currentTime) ? player.currentTime : 0;
  const total = player && isFinite(player.duration) ? player.duration : 0;
  elements.timeCurrent.textContent = formatTime(current);
  elements.timeTotal.textContent = formatTime(total);
}

// Seconds -> "m:ss"
function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
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

  showToast(autoQueueEnabled ? 'Auto-queue enabled' : 'Auto-queue disabled');

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

  showToast(repeatEnabled ? 'Repeat enabled' : 'Repeat disabled');
}

// Shuffle everything after the current song
function shuffleUpcoming() {
  if (!isHost) return;

  const upcoming = queue.slice(currentIndex + 1);
  if (upcoming.length < 2) {
    showToast('Nothing to shuffle yet', 'error');
    return;
  }

  // Fisher-Yates shuffle
  for (let i = upcoming.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
  }

  // The server keeps the current song in place and sends everyone the new order
  socket.emit('reorder-queue', [...queue.slice(0, currentIndex + 1), ...upcoming]);
  showToast('Shuffled upcoming songs');
}

// Clear queue needs a second click, so one stray click can't wipe the queue
let clearQueueTimer = null;

function clearQueue() {
  if (!isHost) return;

  if (queue.length === 0) {
    showToast('Queue is already empty', 'error');
    return;
  }

  const btn = elements.clearQueueBtn;
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.title = 'Click again to clear the queue';
    showToast('Click again to clear the queue', 'error');
    clearQueueTimer = setTimeout(disarmClearQueue, 3000);
    return;
  }

  disarmClearQueue();

  // The server answers when it's done. No answer means it is still running the old code.
  socket.timeout(4000).emit('clear-queue', (err) => {
    if (err) {
      showToast('Server needs its update to clear the queue', 'error');
    }
  });
}

function disarmClearQueue() {
  clearTimeout(clearQueueTimer);
  clearQueueTimer = null;
  elements.clearQueueBtn.classList.remove('armed');
  elements.clearQueueBtn.title = 'Clear queue';
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

  showToast('Finding similar songs...', 'success');

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
      const searchResults = await window.electronAPI.ytSearch(searchQuery);
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
        author: video.author || '',
        lengthSeconds: video.lengthSeconds || 0,
        roomCode,
        username: 'AutoQueue'
      });

      // Small delay between adds to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    showToast(`Added ${videosToAdd.length} songs by ${artistName}!`);

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

  // Keep at most two on screen so they don't bury the queue
  while (elements.toastContainer.children.length >= 2) {
    elements.toastContainer.firstChild.remove();
  }
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function updateVolumeIcon(volume) {
  let icon = 'vol';
  if (Number(volume) === 0) {
    icon = 'vol-mute';
  } else if (volume < 0.5) {
    icon = 'vol-low';
  }
  elements.volumeIcon.querySelector('use').setAttribute('href', `#i-${icon}`);

  // Fills the slider track up to the thumb (see .volume-slider in styles.css)
  elements.volumeSlider.style.setProperty('--vol', `${Math.round(volume * 100)}%`);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========================================
// Start App
// ========================================

document.addEventListener('DOMContentLoaded', init);