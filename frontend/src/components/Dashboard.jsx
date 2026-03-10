import { useState, useEffect, useRef } from 'react';
import { LogOut, Plus, MessageSquare, Menu, X, User as UserIcon, Phone, Video, ChevronLeft, PhoneOff } from 'lucide-react';
import ChatInterface from './ChatInterface';
import RingtoneSynth from '../utils/RingtoneSynth';

export default function Dashboard({ user, socket }) {
  const [activeChats, setActiveChats] = useState([]);
  const [currentChat, setCurrentChat] = useState(null);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatNumbers, setNewChatNumbers] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [callState, setCallState] = useState('idle');
  const [incomingCallData, setIncomingCallData] = useState(null);
  const [activeCallType, setActiveCallType] = useState('video');

  const ringSynthRef = useRef(new RingtoneSynth());
  const { myNumber, username } = user;

  useEffect(() => {
    const savedChats = localStorage.getItem(`active_chats_${myNumber}`);
    if (savedChats) setActiveChats(JSON.parse(savedChats));

    socket.on('receive-message', (data) => {
      updateActiveChats(data.senderNumber, data.message, data.senderName);
    });

    socket.on('incoming-call', (payload) => {
      setIncomingCallData(payload);
      setActiveCallType(payload.callType || 'video');
      setCallState('ringing');
      ringSynthRef.current.playRingin();
    });

    socket.on('call-ended', () => {
      setCallState('idle');
      setIncomingCallData(null);
      ringSynthRef.current.stop();
    });

    return () => {
      socket.off('receive-message');
      socket.off('incoming-call');
      socket.off('call-ended');
      ringSynthRef.current.stop();
    };
  }, [myNumber, socket]);

  const updateActiveChats = (senderNumber, lastMessage, senderName) => {
    setActiveChats((prev) => {
      const existing = prev.find(chat => chat.numbers.includes(senderNumber));
      let updated;
      if (existing) {
        updated = prev.map(chat =>
          chat.numbers.includes(senderNumber)
            ? { ...chat, lastMessage, timestamp: Date.now() }
            : chat
        );
      } else {
        updated = [
          { id: Date.now(), numbers: [senderNumber], name: senderName || senderNumber, lastMessage, timestamp: Date.now() },
          ...prev
        ];
      }
      localStorage.setItem(`active_chats_${myNumber}`, JSON.stringify(updated));
      return updated;
    });
  };

  const startNewChat = (e) => {
    e.preventDefault();
    const numbers = newChatNumbers.split(',').map(n => n.trim()).filter(n => n.length === 6);
    if (numbers.length === 0) return;

    const newChat = { id: Date.now(), numbers, name: numbers.join(', '), lastMessage: 'Start of conversation', timestamp: Date.now() };
    setActiveChats([newChat, ...activeChats]);
    setCurrentChat(newChat);
    setShowNewChatModal(false);
    setNewChatNumbers('');
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const handleSelectChat = (chat) => {
    setCurrentChat(chat);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const rejectCall = () => {
    if (incomingCallData) {
      socket.emit('reject-call', { targetNumber: incomingCallData.callerNumber });
    }
    setCallState('idle');
    setIncomingCallData(null);
    ringSynthRef.current.stop();
  };

  const acceptCall = () => {
    ringSynthRef.current.stop();
    setCallState('idle');
    // Switch to the caller's chat and flag for auto-accept
    handleSelectChat({
      id: Date.now(),
      numbers: [incomingCallData.callerNumber],
      name: incomingCallData.callerName || incomingCallData.callerNumber,
      autoAcceptCall: true,
      pendingCallData: incomingCallData
    });
    setIncomingCallData(null);
  };

  return (
    <div className="dashboard-container">
      {/* Sidebar Section */}
      <div className={`sidebar-main glass ${!sidebarOpen ? 'sidebar-hidden' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'white' }}>Lets Talk</h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{myNumber} • {username}</p>
          </div>
          <button className="btn btn-primary btn-icon-only" onClick={() => setShowNewChatModal(true)}>
            <Plus size={24} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
          {activeChats.length === 0 ? (
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-dim)' }}>
              <MessageSquare size={48} style={{ opacity: 0.1, marginBottom: '1rem' }} />
              <p>No chats yet...</p>
            </div>
          ) : (
            activeChats.map(chat => (
              <div
                key={chat.id}
                onClick={() => handleSelectChat(chat)}
                className="glass"
                style={{
                  margin: '0.5rem', padding: '1rem', borderRadius: '18px', cursor: 'pointer',
                  border: currentChat?.id === chat.id ? '1px solid var(--primary-accent)' : '1px solid transparent',
                  background: currentChat?.id === chat.id ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'var(--gradient-premium)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', flexShrink: 0 }}>
                    {chat.name && chat.name.length > 0 ? chat.name[0].toUpperCase() : chat.numbers[0][0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, fontSize: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{chat.name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', flexShrink: 0, marginLeft: '0.5rem' }}>
                        {new Date(chat.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {chat.lastMessage || 'Open chat...'}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pinned Sign Out — always visible */}
        <div style={{ padding: '1rem', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, background: 'rgba(0,0,0,0.3)' }}>
          <button className="btn" style={{ width: '100%', padding: '0.75rem', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderRadius: '12px' }} onClick={() => { localStorage.clear(); window.location.reload(); }}>
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="content-main">
        {currentChat ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Minimal Header for Mobile */}
            <div className="glass mobile-only" style={{ height: '64px', display: 'flex', alignItems: 'center', padding: '0 1rem', gap: '1rem', zIndex: 10 }}>
              <button
                className="btn btn-icon-only"
                style={{ background: 'rgba(255,255,255,0.05)' }}
                onClick={() => setSidebarOpen(true)}
              >
                <ChevronLeft size={20} />
              </button>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: '1rem', margin: 0 }}>{currentChat.name}</h2>
              </div>
            </div>

            <div style={{ flex: 1, position: 'relative' }}>
              <ChatInterface
                key={currentChat.numbers.join('_')}
                chat={currentChat}
                socket={socket}
                myNumber={myNumber}
                autoAcceptData={currentChat.pendingCallData}
                onMessageSent={(msg) => updateActiveChats(currentChat.numbers[0], msg)}
                onBack={() => setSidebarOpen(true)}
              />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '2rem' }}>
            <button
              className="btn btn-primary btn-icon-only"
              style={{ position: 'absolute', top: '1rem', left: '1rem', display: window.innerWidth <= 768 ? 'flex' : 'none' }}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={24} />
            </button>
            <div style={{ padding: '3rem', borderRadius: '40px', background: 'var(--bg-card)', textAlign: 'center' }}>
              <div style={{ width: '100px', height: '100px', borderRadius: '30px', background: 'var(--gradient-premium)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem', boxShadow: '0 20px 40px var(--primary-glow)' }}>
                <MessageSquare size={48} color="white" />
              </div>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem' }}>Start Talking</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Premium, secure, and instant.</p>
            </div>
          </div>
        )}
      </div>

      {/* Modern Call Overlay */}
      {callState === 'ringing' && incomingCallData && (
        <div className="glass animate-slide-up" style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.9)' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="animate-scale-in" style={{ width: '140px', height: '140px', borderRadius: '40px', background: 'var(--gradient-premium)', margin: '0 auto 3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 30px 60px var(--primary-glow)' }}>
              <UserIcon size={80} color="white" />
            </div>
            <h1 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>{incomingCallData.callerName || incomingCallData.callerNumber}</h1>
            <div className="call-timer" style={{ display: 'inline-block', color: 'var(--primary-accent)' }}>Incoming {activeCallType} call...</div>
          </div>

          <div style={{ marginTop: '5rem', display: 'flex', gap: '3rem' }}>
            <button onClick={rejectCall} className="btn btn-danger btn-icon-only" style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'var(--danger)', color: 'white' }}>
              <PhoneOff size={32} />
            </button>
            <button onClick={acceptCall} className="btn btn-icon-only" style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'var(--success)', color: 'white', animation: 'pulse-glow 2s infinite' }}>
              {activeCallType === 'video' ? <Video size={32} /> : <Phone size={32} />}
            </button>
          </div>
        </div>
      )}

      {/* Premium New Chat Modal */}
      {showNewChatModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem' }}>
          <div className="glass animate-scale-in" style={{ padding: '2.5rem', width: '100%', maxWidth: '450px', borderRadius: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Start Chat</h2>
              <button className="icon-btn" onClick={() => setShowNewChatModal(false)} style={{ color: 'var(--text-dim)' }}><X size={28} /></button>
            </div>
            <form onSubmit={startNewChat}>
              <div style={{ marginBottom: '2rem' }}>
                <label style={{ display: 'block', marginBottom: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Recipient Numbers</label>
                <input
                  type="text"
                  className="input-premium"
                  style={{ width: '100%' }}
                  placeholder="Enter 6-digit numbers..."
                  value={newChatNumbers}
                  onChange={(e) => setNewChatNumbers(e.target.value.replace(/[^\d,]/g, ''))}
                  autoFocus
                />
                <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.6rem' }}>Separate multiple numbers with commas.</p>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '1.2rem' }}>
                Create Conversation
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
