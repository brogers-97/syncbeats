const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store active rooms
const rooms = new Map();

// Generate a random 6-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

io.on('connection', (socket) => {
  console.log('🟢 USER CONNECTED:', socket.id);

  // Create a new room
  socket.on('create-room', (username) => {
    console.log(`📝 CREATE ROOM request from: ${username}`);
    const roomCode = generateRoomCode();
    
    rooms.set(roomCode, {
      hostId: socket.id,
      queue: [],
      currentIndex: 0,
      isPlaying: false,
      currentTime: 0,
      lastTimeUpdate: Date.now(),
      users: [{ id: socket.id, username, isHost: true }]
    });

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.username = username;

    socket.emit('room-created', { 
      roomCode, 
      isHost: true,
      users: rooms.get(roomCode).users
    });

    console.log(`✅ ROOM CREATED: ${roomCode} by ${username}`);
  });

  // Join an existing room
  socket.on('join-room', ({ roomCode, username }) => {
    console.log(`📝 JOIN ROOM request: ${username} wants to join ${roomCode}`);
    const room = rooms.get(roomCode.toUpperCase());

    if (!room) {
      console.log(`❌ ROOM NOT FOUND: ${roomCode}`);
      socket.emit('error', { message: 'Room not found! Check the code and try again.' });
      return;
    }

    room.users.push({ id: socket.id, username, isHost: false });
    socket.join(roomCode.toUpperCase());
    socket.roomCode = roomCode.toUpperCase();
    socket.username = username;

    socket.emit('room-joined', {
      roomCode: roomCode.toUpperCase(),
      isHost: false,
      queue: room.queue,
      currentIndex: room.currentIndex,
      isPlaying: room.isPlaying,
      currentTime: room.currentTime,
      users: room.users
    });

    io.to(roomCode.toUpperCase()).emit('user-joined', { 
      username, 
      users: room.users 
    });

    console.log(`✅ USER JOINED: ${username} joined room ${roomCode.toUpperCase()}`);
  });

  // Add a song to the queue
  socket.on('add-song', ({ videoId, title, thumbnail, roomCode: passedRoomCode, username: passedUsername }) => {
    const effectiveRoomCode = socket.roomCode || passedRoomCode;
    const effectiveUsername = socket.username || passedUsername || 'Someone';
    
    if (!socket.roomCode && passedRoomCode) {
      socket.roomCode = passedRoomCode;
      socket.join(passedRoomCode);
    }
    if (!socket.username && passedUsername) {
      socket.username = passedUsername;
    }
    
    console.log(`🎵 ADD SONG from ${effectiveUsername}: ${title}`);
    const room = rooms.get(effectiveRoomCode);
    if (!room) {
      console.log(`❌ ADD SONG failed - room not found: ${effectiveRoomCode}`);
      return;
    }

    const song = {
      id: Date.now().toString(),
      videoId,
      title: title || 'Unknown Title',
      addedBy: effectiveUsername,
      thumbnail
    };

    room.queue.push(song);

    io.to(effectiveRoomCode).emit('queue-updated', { 
      queue: room.queue,
      currentIndex: room.currentIndex
    });

    console.log(`✅ SONG ADDED to ${effectiveRoomCode}: "${title}"`);
  });

  // Host reorders the queue
  socket.on('reorder-queue', (newQueue) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    room.queue = newQueue;
    io.to(socket.roomCode).emit('queue-updated', { 
      queue: room.queue,
      currentIndex: room.currentIndex
    });
  });

  // Host removes a song
  socket.on('remove-song', (songId) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    const index = room.queue.findIndex(s => s.id === songId);
    if (index === -1) return;

    room.queue.splice(index, 1);
    
    if (index < room.currentIndex) {
      room.currentIndex--;
    } else if (index === room.currentIndex && room.currentIndex >= room.queue.length) {
      room.currentIndex = Math.max(0, room.queue.length - 1);
    }

    io.to(socket.roomCode).emit('queue-updated', { 
      queue: room.queue,
      currentIndex: room.currentIndex
    });
  });

  // Playback controls (host only)
  socket.on('play', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    room.isPlaying = true;
    room.lastTimeUpdate = Date.now();
    io.to(socket.roomCode).emit('playback-state', { 
      isPlaying: true, 
      currentTime: room.currentTime 
    });
  });

  socket.on('pause', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    room.isPlaying = false;
    io.to(socket.roomCode).emit('playback-state', { 
      isPlaying: false, 
      currentTime: room.currentTime 
    });
  });

  // Host syncs current playback time
  socket.on('sync-time', (currentTime) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    room.currentTime = currentTime;
    room.lastTimeUpdate = Date.now();
    
    socket.to(socket.roomCode).emit('time-sync', { currentTime });
  });

  // Skip to next song
  socket.on('next-song', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    if (room.currentIndex < room.queue.length - 1) {
      room.currentIndex++;
      room.currentTime = 0;
      io.to(socket.roomCode).emit('song-changed', { 
        currentIndex: room.currentIndex,
        currentTime: 0
      });
    }
  });

  // Go to previous song
  socket.on('prev-song', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    if (room.currentIndex > 0) {
      room.currentIndex--;
      room.currentTime = 0;
      io.to(socket.roomCode).emit('song-changed', { 
        currentIndex: room.currentIndex,
        currentTime: 0
      });
    }
  });

  // Play specific song from queue
  socket.on('play-song', (index) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    if (index >= 0 && index < room.queue.length) {
      room.currentIndex = index;
      room.currentTime = 0;
      room.isPlaying = true;
      io.to(socket.roomCode).emit('song-changed', { 
        currentIndex: room.currentIndex,
        currentTime: 0,
        isPlaying: true
      });
    }
  });

  // Song ended naturally
  socket.on('song-ended', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;

    if (room.currentIndex < room.queue.length - 1) {
      room.currentIndex++;
      room.currentTime = 0;
      io.to(socket.roomCode).emit('song-changed', { 
        currentIndex: room.currentIndex,
        currentTime: 0,
        isPlaying: true
      });
    } else {
      room.isPlaying = false;
      io.to(socket.roomCode).emit('playback-state', { isPlaying: false });
    }
  });

  // Request sync
  socket.on('request-sync', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    socket.emit('full-sync', {
      queue: room.queue,
      currentIndex: room.currentIndex,
      isPlaying: room.isPlaying,
      currentTime: room.currentTime
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('🔴 USER DISCONNECTED:', socket.id);

    if (!socket.roomCode) return;

    const room = rooms.get(socket.roomCode);
    if (!room) return;

    room.users = room.users.filter(u => u.id !== socket.id);

    if (room.hostId === socket.id) {
      io.to(socket.roomCode).emit('room-closed', { 
        message: 'The host has left. Room closed.' 
      });
      rooms.delete(socket.roomCode);
      console.log(`Room ${socket.roomCode} closed (host left)`);
    } else {
      io.to(socket.roomCode).emit('user-left', { 
        username: socket.username, 
        users: room.users 
      });
    }
  });

  // Leave room manually
  socket.on('leave-room', () => {
    if (!socket.roomCode) return;

    const room = rooms.get(socket.roomCode);
    if (!room) return;

    room.users = room.users.filter(u => u.id !== socket.id);
    socket.leave(socket.roomCode);

    if (room.hostId === socket.id) {
      io.to(socket.roomCode).emit('room-closed', { 
        message: 'The host has left. Room closed.' 
      });
      rooms.delete(socket.roomCode);
    } else {
      io.to(socket.roomCode).emit('user-left', { 
        username: socket.username, 
        users: room.users 
      });
    }

    socket.roomCode = null;
    socket.emit('left-room');
  });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'SyncBeats server running',
    rooms: rooms.size,
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🎵 SyncBeats server running on port ${PORT}`);
});