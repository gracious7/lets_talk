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
    let username, previousNumber;
    if (typeof data === 'string') {
      username = data;
    } else {
      username = data.username;
      previousNumber = data.previousNumber;
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

    users[socket.id] = { number, username };
    numbersToSockets[number] = socket.id;

    socket.emit('registered', { number });
    console.log(`User ${username} (${socket.id}) registered with number ${number}`);
  });

  // ─── Chat Message Relay ────────────────────────────────────
  socket.on('send-message', (payload) => {
    const senderData = users[socket.id];
    if (!senderData) return;

    const targets = getTargetSocketIds(payload.targetNumbers || payload.targetNumber);
    targets.forEach(({ socketId }) => {
      io.to(socketId).emit('receive-message', {
        senderNumber: senderData.number,
        senderName: senderData.username,
        message: payload.message
      });
    });
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
      delete users[socket.id];
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
