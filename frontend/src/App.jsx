import { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import ConnectUser from './components/ConnectUser';
import Dashboard from './components/Dashboard';

const SERVER_URL = 'http://localhost:5000';

function App() {
  const [user, setUser] = useState(null); // { myNumber, username }
  const socketRef = useRef(null);

  const handleRegister = (username) => {
    if (socketRef.current) return;
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('register', username);
    });

    socket.on('registered', (data) => {
      setUser({ myNumber: data.number, username });
    });

    socket.on('connect_error', () => {
      alert('Failed to connect to signaling server. Please check if the backend is running.');
      socketRef.current = null;
    });
  };

  // Global socket cleanup
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div className="app-container" style={{ width: '100%', height: '100vh' }}>
      {!user ? (
        <ConnectUser onRegister={handleRegister} />
      ) : (
        <Dashboard user={user} socket={socketRef.current} />
      )}
    </div>
  );
}

export default App;
