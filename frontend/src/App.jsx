import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import ConnectUser from './components/ConnectUser';
import Dashboard from './components/Dashboard';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://lets-talk-w1xp.onrender.com';

function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('lets_talk_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [socket, setSocket] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // connected, disconnected, reconnecting

  const connectSocket = (username, previousNumber = null) => {
    if (socket) return;
    const newSocket = io(SERVER_URL, {
      transports: ['websocket'],
      upgrade: false,
      // Faster disconnect detection
      pingTimeout: 10000,
      pingInterval: 5000,
      // Reconnection settings
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('[Socket] Connected:', newSocket.id);
      setConnectionStatus('connected');
      // Always re-register on connect (handles both initial + reconnect)
      newSocket.emit('register', { username, previousNumber });
    });

    newSocket.on('registered', (data) => {
      const newUser = { myNumber: data.number, username };
      setUser(newUser);
      localStorage.setItem('lets_talk_user', JSON.stringify(newUser));
    });

    newSocket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
      setConnectionStatus('disconnected');
    });

    newSocket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
      setConnectionStatus('reconnecting');
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log(`[Socket] Reconnected after ${attemptNumber} attempts`);
      setConnectionStatus('connected');
    });

    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`[Socket] Reconnection attempt #${attemptNumber}`);
      setConnectionStatus('reconnecting');
    });

    newSocket.on('reconnect_failed', () => {
      console.error('[Socket] Reconnection failed permanently');
      setConnectionStatus('disconnected');
      alert('Lost connection to server. Please refresh the page.');
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
        <>
          <Dashboard user={user} socket={socket} />
          {/* Connection status banner */}
          {connectionStatus === 'reconnecting' && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
              background: 'linear-gradient(90deg, #ff6b35, #f7931e)',
              color: 'white', textAlign: 'center', padding: '0.5rem',
              fontSize: '0.85rem', fontWeight: 600,
              animation: 'pulse-bg 2s infinite'
            }}>
              ⚠ Reconnecting to server...
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
