import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import ConnectUser from './components/ConnectUser';
import Dashboard from './components/Dashboard';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://lets-talk-w1xp.onrender.com';

function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('lets_talk_user');
    return savedUser ? JSON.parse(savedUser) : null;
  }); // { myNumber, username }
  const [socket, setSocket] = useState(null);

  const connectSocket = (username, previousNumber = null) => {
    if (socket) return;
    const newSocket = io(SERVER_URL, {
      transports: ['websocket'],
      upgrade: false
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('register', { username, previousNumber });
    });

    newSocket.on('registered', (data) => {
      const newUser = { myNumber: data.number, username };
      setUser(newUser);
      localStorage.setItem('lets_talk_user', JSON.stringify(newUser));
    });

    newSocket.on('connect_error', () => {
      alert('Failed to connect to signaling server. Please check if the backend is running.');
      setSocket(null);
    });
  };

  useEffect(() => {
    if (user && !socket) {
      connectSocket(user.username, user.myNumber);
    }
  }, []); // Run once on mount to restore session

  // Global socket cleanup
  useEffect(() => {
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [socket]);

  return (
    <div className="app-container" style={{ width: '100%', height: '100vh' }}>
      {!user ? (
        <ConnectUser onRegister={(username) => connectSocket(username)} />
      ) : !socket ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'white' }}>Reconnecting...</div>
      ) : (
        <Dashboard user={user} socket={socket} />
      )}
    </div>
  );
}

export default App;
