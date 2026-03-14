const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.send('Signaling server is running!');
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Faster disconnect detection
  pingTimeout: 10000,
  pingInterval: 5000
});

// Map to store connected users: socket.id -> { number, username }
const users = {};
// Map to quickly find socket.id by number: number -> socket.id
const numbersToSockets = {};
// Track active calls: number -> Set of numbers they're in a call with
const activeCalls = {};

// Map to track message counts: senderNumber -> targetNumber -> count
const messageCounts = {};

function getRandomColor() {
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function broadcastPublicUsers() {
  const publicUsers = Object.values(users).filter(u => u.visibility === 'public');
  io.emit('public-users-update', publicUsers);
}

function generateNumber() {
  let num;
  do {
    num = Math.floor(100000 + Math.random() * 900000).toString();
  } while (numbersToSockets[num]);
  return num;
}

// Helper to get target socket IDs from target numbers
function getTargetSocketIds(targetNumbers) {
  const targets = Array.isArray(targetNumbers) ? targetNumbers : [targetNumbers];
  return targets.map(num => ({
    number: num,
    socketId: numbersToSockets[num]
  })).filter(t => t.socketId);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ─── Registration ──────────────────────────────────────────
  socket.on('register', (data) => {
    let username, previousNumber, visibility;
    if (typeof data === 'string') {
      username = data;
      visibility = 'private';
    } else {
      username = data.username;
      previousNumber = data.previousNumber;
      visibility = data.visibility || 'private';
    }

    // If this socket was already registered, clean up the old mapping
    if (users[socket.id]) {
      const oldNumber = users[socket.id].number;
      if (numbersToSockets[oldNumber] === socket.id) {
        delete numbersToSockets[oldNumber];
      }
    }

    let number;
    if (previousNumber && !numbersToSockets[previousNumber]) {
      number = previousNumber;
    } else if (previousNumber && numbersToSockets[previousNumber] === socket.id) {
      // Same socket re-registering with same number (reconnect)
      number = previousNumber;
    } else {
      number = generateNumber();
    }

    const avatarColor = getRandomColor();
    users[socket.id] = { number, username, visibility, avatarColor };
    numbersToSockets[number] = socket.id;

    socket.emit('registered', { number });
    console.log(`User ${username} (${socket.id}) registered with number ${number}, visibility: ${visibility}`);
    broadcastPublicUsers();
  });

  // ─── Chat Message Relay ────────────────────────────────────
  socket.on('send-message', (payload) => {
    const senderData = users[socket.id];
    if (!senderData) return;

    const targets = getTargetSocketIds(payload.targetNumbers || payload.targetNumber);
    targets.forEach(({ socketId, number }) => {
      // Track message count
      if (!messageCounts[senderData.number]) messageCounts[senderData.number] = {};
      if (!messageCounts[senderData.number][number]) messageCounts[senderData.number][number] = 0;
      messageCounts[senderData.number][number]++;

      io.to(socketId).emit('receive-message', {
        senderNumber: senderData.number,
        senderName: senderData.username,
        message: payload.message,
        messageCount: messageCounts[senderData.number][number]
      });
    });
  });

  socket.on('set-visibility', (payload) => {
    if (users[socket.id]) {
      users[socket.id].visibility = payload.visibility;
      broadcastPublicUsers();
    }
  });

  socket.on('get-message-count', (payload, callback) => {
    const myData = users[socket.id];
    if (!myData) return;
    const count = (messageCounts[payload.peerNumber] && messageCounts[payload.peerNumber][myData.number]) || 0;
    if (typeof callback === 'function') {
      callback({ count });
    } else {
      socket.emit('message-count', { peerNumber: payload.peerNumber, count });
    }
  });

  socket.on('request-call-permission', (payload) => {
    const targetSocketId = numbersToSockets[payload.targetNumber];
    if (targetSocketId) {
      socket.to(targetSocketId).emit('call-permission-request', {
        requesterNumber: users[socket.id]?.number,
        requesterName: users[socket.id]?.username
      });
    }
  });

  socket.on('call-permission-response', (payload) => {
    const targetSocketId = numbersToSockets[payload.targetNumber];
    if (targetSocketId) {
      socket.to(targetSocketId).emit('call-permission-response', {
        responderNumber: users[socket.id]?.number,
        accepted: payload.accepted
      });
    }
  });

  // ─── WebRTC Signaling Relay ────────────────────────────────

  socket.on('call-offer', (payload) => {
    const targets = getTargetSocketIds(payload.targetNumbers || payload.targetNumber);
    const senderData = users[socket.id];
    targets.forEach(({ socketId }) => {
      socket.to(socketId).emit('call-offer', {
        callerNumber: senderData?.number,
        offer: payload.offer,
        callType: payload.callType,
        iceRestart: payload.iceRestart || false
      });
    });
  });

  socket.on('call-answer', (payload) => {
    const targets = getTargetSocketIds(payload.targetNumbers || payload.targetNumber);
    targets.forEach(({ socketId }) => {
      socket.to(socketId).emit('call-answer', {
        answer: payload.answer
      });
    });
  });

  socket.on('ice-candidate', (payload) => {
    const targets = getTargetSocketIds(payload.targetNumbers || payload.targetNumber);
    targets.forEach(({ socketId }) => {
      socket.to(socketId).emit('ice-candidate', {
        candidate: payload.candidate
      });
    });
  });

  // ─── Call Lifecycle ────────────────────────────────────────

  socket.on('initiate-call', (payload) => {
    const senderData = users[socket.id];
    if (!senderData) return;

    const targets = getTargetSocketIds(payload.targetNumbers || payload.targetNumber);
    
    // Track active call
    activeCalls[senderData.number] = new Set(targets.map(t => t.number));

    targets.forEach(({ socketId, number }) => {
      // Track the reverse direction too
      if (!activeCalls[number]) activeCalls[number] = new Set();
      activeCalls[number].add(senderData.number);

      socket.to(socketId).emit('incoming-call', {
        callerNumber: senderData.number,
        callerName: senderData.username,
        callType: payload.callType
      });
    });
  });

  socket.on('accept-call', (payload) => {
    const targetSocketId = numbersToSockets[payload.targetNumber];
    if (targetSocketId) {
      socket.to(targetSocketId).emit('call-accepted', {
        accepterNumber: users[socket.id]?.number
      });
    }
  });

  socket.on('reject-call', (payload) => {
    const targetSocketId = numbersToSockets[payload.targetNumber];
    if (targetSocketId) {
      socket.to(targetSocketId).emit('call-rejected');
    }
    // Clean up call tracking
    const myNumber = users[socket.id]?.number;
    if (myNumber) {
      delete activeCalls[myNumber];
    }
  });

  socket.on('end-call', (payload) => {
    const targets = getTargetSocketIds(payload.targetNumbers || payload.targetNumber);
    const myNumber = users[socket.id]?.number;

    targets.forEach(({ socketId, number }) => {
      socket.to(socketId).emit('call-ended');
      // Clean up call tracking for the remote side
      if (activeCalls[number]) {
        activeCalls[number].delete(myNumber);
        if (activeCalls[number].size === 0) delete activeCalls[number];
      }
    });

    // Clean up call tracking for this side
    if (myNumber) {
      delete activeCalls[myNumber];
    }
  });

  // ─── Chat Exit ─────────────────────────────────────────────
  socket.on('exit-chat', (payload) => {
    const targetSocketId = numbersToSockets[payload.targetNumber];
    if (targetSocketId) {
      socket.to(targetSocketId).emit('peer-disconnected');
    }
  });

  // ─── Disconnect ────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const userData = users[socket.id];
    if (userData) {
      const myNumber = userData.number;

      // Notify all peers in active calls that we disconnected
      if (activeCalls[myNumber]) {
        activeCalls[myNumber].forEach(peerNumber => {
          const peerSocketId = numbersToSockets[peerNumber];
          if (peerSocketId) {
            io.to(peerSocketId).emit('call-ended');
            // Clean up peer's call tracking
            if (activeCalls[peerNumber]) {
              activeCalls[peerNumber].delete(myNumber);
              if (activeCalls[peerNumber].size === 0) delete activeCalls[peerNumber];
            }
          }
        });
        delete activeCalls[myNumber];
      }

      // Free up the number
      delete numbersToSockets[myNumber];
      const wasPublic = users[socket.id]?.visibility === 'public';
      delete users[socket.id];
      if (wasPublic) broadcastPublicUsers();
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
