const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Map to store connected users: socket.id -> { number, username }
const users = {};
// Map to quickly find socket.id by number: number -> socket.id
const numbersToSockets = {};

function generateNumber() {
  let num;
  do {
    // Generate a 6 digit number
    num = Math.floor(100000 + Math.random() * 900000).toString();
  } while (numbersToSockets[num]);
  return num;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // When frontend asks for a number
  socket.on('register', (username) => {
    const number = generateNumber();
    users[socket.id] = { number, username };
    numbersToSockets[number] = socket.id;
    
    // Send the assigned number back to the user
    socket.emit('registered', { number });
    console.log(`User ${username} (${socket.id}) registered with number ${number}`);
  });

  // Chat Message Relay — THE CRITICAL MISSING PIECE
  socket.on('send-message', (payload) => {
    const senderData = users[socket.id];
    if (!senderData) return;
    const targets = Array.isArray(payload.targetNumbers) ? payload.targetNumbers : [payload.targetNumber];
    targets.forEach(target => {
      const targetSocketId = numbersToSockets[target];
      if (targetSocketId) {
        io.to(targetSocketId).emit('receive-message', {
          senderNumber: senderData.number,
          senderName: senderData.username,
          message: payload.message
        });
      }
    });
  });

  // WebRTC Signaling Relay
  socket.on('call-offer', (payload) => {
    const targets = Array.isArray(payload.targetNumbers) ? payload.targetNumbers : [payload.targetNumber];
    targets.forEach(target => {
      const targetSocketId = numbersToSockets[target];
      if (targetSocketId) {
        socket.to(targetSocketId).emit('call-offer', {
          callerNumber: users[socket.id]?.number,
          offer: payload.offer,
          callType: payload.callType
        });
      }
    });
  });

  socket.on('call-answer', (payload) => {
    const targets = Array.isArray(payload.targetNumbers) ? payload.targetNumbers : [payload.targetNumber];
    targets.forEach(target => {
      const targetSocketId = numbersToSockets[target];
      if (targetSocketId) {
        socket.to(targetSocketId).emit('call-answer', {
          answer: payload.answer
        });
      }
    });
  });

  socket.on('ice-candidate', (payload) => {
    const targets = Array.isArray(payload.targetNumbers) ? payload.targetNumbers : [payload.targetNumber];
    targets.forEach(target => {
      const targetSocketId = numbersToSockets[target];
      if (targetSocketId) {
        socket.to(targetSocketId).emit('ice-candidate', {
          candidate: payload.candidate
        });
      }
    });
  });

  // Handle explicit call initiation (The "Ringing" phase)
  socket.on('initiate-call', (payload) => {
    const targets = Array.isArray(payload.targetNumbers) ? payload.targetNumbers : [payload.targetNumber];
    const senderData = users[socket.id];
    if (senderData) {
      targets.forEach(target => {
        const targetSocketId = numbersToSockets[target];
        if (targetSocketId) {
          socket.to(targetSocketId).emit('incoming-call', {
            callerNumber: senderData.number,
            callerName: senderData.username,
            callType: payload.callType
          });
        }
      });
    }
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
  });

  socket.on('end-call', (payload) => {
    const targets = Array.isArray(payload.targetNumbers) ? payload.targetNumbers : [payload.targetNumber];
    targets.forEach(target => {
      const targetSocketId = numbersToSockets[target];
      if (targetSocketId) {
        socket.to(targetSocketId).emit('call-ended');
      }
    });
  });

  // Handle exiting a direct chat explicitly (notify the other peer)
  socket.on('exit-chat', (payload) => {
    const targetSocketId = numbersToSockets[payload.targetNumber];
    if (targetSocketId) {
      socket.to(targetSocketId).emit('peer-disconnected');
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const userData = users[socket.id];
    if (userData) {
      // Free up the number
      delete numbersToSockets[userData.number];
      delete users[socket.id];
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
