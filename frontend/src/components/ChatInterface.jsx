import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Smile, Paperclip, Phone, Video, X, Mic, MicOff, VideoOff, PhoneOff, User as UserIcon, MoreVertical, ChevronLeft, Loader, WifiOff, Wifi } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import RingtoneSynth from '../utils/RingtoneSynth';
import WebRTCManager from '../utils/WebRTCManager';

export default function ChatInterface({ chat, socket, myNumber, autoAcceptData, onMessageSent, onBack }) {
  const { numbers: targetNumbers, name: chatName } = chat;
  const primaryTarget = targetNumbers[0];

  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const [callState, setCallState] = useState('idle'); // idle, calling, connecting, in-call
  const [activeCallType, setActiveCallType] = useState('video');
  const [callDuration, setCallDuration] = useState(0);
  const [connectionQuality, setConnectionQuality] = useState('good'); // good, fair, poor, reconnecting

  // Refs — these avoid re-registering socket listeners on every state change
  const callStateRef = useRef('idle');
  const activeCallTypeRef = useRef('video');
  const managerRef = useRef(null);
  const ringSynthRef = useRef(new RingtoneSynth());

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const messagesEndRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const fileInputRef = useRef(null);

  // Keep refs in sync with state
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { activeCallTypeRef.current = activeCallType; }, [activeCallType]);

  // ─── Chat History ──────────────────────────────────────────

  useEffect(() => {
    const participants = [myNumber, ...targetNumbers].sort();
    const storageKey = `chat_history_${participants.join('_')}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) setMessages(JSON.parse(stored));
  }, [myNumber, targetNumbers]);

  useEffect(() => {
    const participants = [myNumber, ...targetNumbers].sort();
    const storageKey = `chat_history_${participants.join('_')}`;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, myNumber, targetNumbers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Cleanup on unmount ────────────────────────────────────

  useEffect(() => {
    return () => {
      ringSynthRef.current.stop();
      destroyManager();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // ─── Bind video elements when in-call ──────────────────────

  useEffect(() => {
    if (callState === 'in-call' && managerRef.current) {
      if (localVideoRef.current && managerRef.current.localStream) {
        localVideoRef.current.srcObject = managerRef.current.localStream;
      }
      if (remoteVideoRef.current && managerRef.current.remoteStream) {
        remoteVideoRef.current.srcObject = managerRef.current.remoteStream;
      }
      if (remoteAudioRef.current && managerRef.current.remoteStream) {
        remoteAudioRef.current.srcObject = managerRef.current.remoteStream;
      }
    }
  }, [callState, isVideoOff, activeCallType]);

  // ─── WebRTC Manager Lifecycle ──────────────────────────────

  const createManager = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.destroy();
    }
    const manager = new WebRTCManager();

    manager.onLocalStream = (stream) => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    };

    manager.onRemoteStream = (stream) => {
      // Bind to BOTH video and audio elements for maximum compatibility
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
      }
    };

    manager.onTrackReceived = (kind) => {
      ringSynthRef.current.stop();
      if (callStateRef.current !== 'in-call') {
        setCallState('in-call');
        startTimer();
      }
    };

    manager.onConnectionStateChange = (state) => {
      switch (state) {
        case 'connecting':
          setConnectionQuality('good');
          break;
        case 'connected':
          setConnectionQuality('good');
          if (callStateRef.current === 'connecting') {
            // We might not have tracks yet, but we are connected
          }
          break;
        case 'reconnecting':
          setConnectionQuality('reconnecting');
          break;
        case 'failed':
          setConnectionQuality('poor');
          // If we can't recover, end the call after a moment
          setTimeout(() => {
            if (managerRef.current && managerRef.current.pc?.iceConnectionState === 'failed') {
              endCall();
            }
          }, 10000);
          break;
        case 'closed':
          endCallLocally();
          break;
      }
    };

    manager.onIceCandidate = (candidate) => {
      socket.emit('ice-candidate', {
        targetNumbers: manager.isInitiator ? targetNumbers : [primaryTarget],
        candidate
      });
    };

    manager.onNegotiationNeeded = (offer) => {
      // ICE restart: send the new offer to the remote peer
      socket.emit('call-offer', {
        targetNumbers,
        offer,
        callType: activeCallTypeRef.current,
        iceRestart: true
      });
    };

    manager.onStatsUpdate = (stats) => {
      if (stats.packetLoss > 10 || stats.roundTripTime > 500) {
        setConnectionQuality('poor');
      } else if (stats.packetLoss > 3 || stats.roundTripTime > 200) {
        setConnectionQuality('fair');
      } else {
        if (connectionQuality !== 'reconnecting') {
          setConnectionQuality('good');
        }
      }
    };

    manager.onError = (err) => {
      console.error('[ChatInterface] WebRTC error:', err);
    };

    managerRef.current = manager;
    return manager;
  }, [socket, targetNumbers, primaryTarget]);

  const destroyManager = () => {
    if (managerRef.current) {
      managerRef.current.destroy();
      managerRef.current = null;
    }
  };

  // ─── Call Flow: Initiator ──────────────────────────────────

  const initiateCall = (type) => {
    setActiveCallType(type);
    setCallState('calling');
    setIsVideoOff(type !== 'video');
    ringSynthRef.current.playRingout();
    socket.emit('initiate-call', { targetNumbers, callType: type });
  };

  const startWebRTCAsInitiator = useCallback(async (type) => {
    try {
      const manager = createManager();
      await manager.initialize(type);
      setCallState('connecting');
      const offer = await manager.createOffer();
      socket.emit('call-offer', { targetNumbers, offer, callType: type });
    } catch (err) {
      console.error('Failed to start WebRTC:', err);
      alert(`Could not start call: ${err.message}`);
      endCallLocally();
    }
  }, [createManager, socket, targetNumbers]);

  // ─── Call Flow: Receiver ───────────────────────────────────

  const startWebRTCAsReceiver = useCallback(async (offer, type) => {
    try {
      const manager = createManager();
      await manager.initialize(type);
      setCallState('connecting');
      setIsVideoOff(type !== 'video');
      const answer = await manager.handleOffer(offer);
      socket.emit('call-answer', { targetNumbers: [primaryTarget], answer });
    } catch (err) {
      console.error('Failed to answer WebRTC:', err);
      alert(`Could not accept call: ${err.message}`);
      endCallLocally();
    }
  }, [createManager, socket, primaryTarget]);

  // ─── Auto-accept incoming call (receiver landed in chat) ───

  useEffect(() => {
    if (autoAcceptData) {
      socket.emit('accept-call', { targetNumber: primaryTarget });
      setCallState('connecting');
      setActiveCallType(autoAcceptData.callType || 'video');
    }
  }, [autoAcceptData, primaryTarget, socket]);

  // ─── Socket Event Handlers (registered ONCE) ──────────────

  useEffect(() => {
    const handleCallOffer = async (data) => {
      if (data.callerNumber === primaryTarget) {
        if (data.iceRestart && managerRef.current) {
          // ICE restart: handle the new offer on existing manager
          try {
            const answer = await managerRef.current.handleOffer(data.offer);
            socket.emit('call-answer', { targetNumbers: [primaryTarget], answer });
          } catch (err) {
            console.error('ICE restart offer handling failed:', err);
          }
        } else {
          // Normal call offer — start WebRTC as receiver
          startWebRTCAsReceiver(data.offer, data.callType);
        }
      }
    };

    const handleCallAccepted = () => {
      if (callStateRef.current === 'calling') {
        ringSynthRef.current.stop();
        startWebRTCAsInitiator(activeCallTypeRef.current);
      }
    };

    const handleCallAnswer = async (data) => {
      if (managerRef.current) {
        await managerRef.current.handleAnswer(data.answer);
      }
    };

    const handleIceCandidate = async (data) => {
      if (managerRef.current) {
        await managerRef.current.addIceCandidate(data.candidate);
      }
    };

    const handleCallRejected = () => {
      alert('Call was rejected');
      endCallLocally();
    };

    const handleCallEnded = () => {
      endCallLocally();
    };

    const handleReceiveMessage = (data) => {
      if (data.senderNumber === primaryTarget) {
        const newMsg = { text: data.message, sender: 'them', time: new Date() };
        setMessages(prev => [...prev, newMsg]);
      }
    };

    socket.on('call-offer', handleCallOffer);
    socket.on('call-accepted', handleCallAccepted);
    socket.on('call-answer', handleCallAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('call-rejected', handleCallRejected);
    socket.on('call-ended', handleCallEnded);
    socket.on('receive-message', handleReceiveMessage);

    return () => {
      socket.off('call-offer', handleCallOffer);
      socket.off('call-accepted', handleCallAccepted);
      socket.off('call-answer', handleCallAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('call-rejected', handleCallRejected);
      socket.off('call-ended', handleCallEnded);
      socket.off('receive-message', handleReceiveMessage);
    };
    // IMPORTANT: Only socket & primaryTarget as deps — callState/activeCallType
    // are accessed via refs to avoid re-subscribe cycles
  }, [socket, primaryTarget, startWebRTCAsInitiator, startWebRTCAsReceiver]);

  // ─── Call Controls ─────────────────────────────────────────

  const endCall = () => {
    socket.emit('end-call', { targetNumbers });
    endCallLocally();
  };

  const endCallLocally = () => {
    destroyManager();
    setCallState('idle');
    setConnectionQuality('good');
    stopTimer();
    ringSynthRef.current.stop();
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (managerRef.current) {
      managerRef.current.setMuted(newMuted);
    }
  };

  const toggleVideo = () => {
    const newOff = !isVideoOff;
    setIsVideoOff(newOff);
    if (managerRef.current) {
      managerRef.current.setVideoEnabled(!newOff);
    }
  };

  // ─── Timer ─────────────────────────────────────────────────

  const startTimer = () => {
    setCallDuration(0);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  // ─── Chat ──────────────────────────────────────────────────

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target.result;
      socket.emit('send-message', { targetNumbers, message: base64String });
      const newMsg = { text: base64String, sender: 'me', time: new Date() };
      setMessages(prev => [...prev, newMsg]);
      onMessageSent('Image');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const sendMessage = (e) => {
    if (e) e.preventDefault();
    if (inputMessage.trim()) {
      socket.emit('send-message', { targetNumbers, message: inputMessage });
      const newMsg = { text: inputMessage, sender: 'me', time: new Date() };
      setMessages(prev => [...prev, newMsg]);
      onMessageSent(inputMessage);
      setInputMessage('');
      setShowEmojiPicker(false);
    }
  };

  // ─── Connection quality indicator ──────────────────────────

  const QualityIndicator = () => {
    if (callState !== 'in-call') return null;
    const colors = { good: 'var(--success)', fair: '#ffa500', poor: 'var(--danger)', reconnecting: '#ffa500' };
    const labels = { good: 'Strong', fair: 'Weak', poor: 'Poor', reconnecting: 'Reconnecting...' };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', padding: '0.3rem 0.8rem', borderRadius: '99px', fontSize: '0.75rem' }}>
        {connectionQuality === 'reconnecting' ? (
          <WifiOff size={14} color={colors[connectionQuality]} className="pulse-anim" />
        ) : (
          <Wifi size={14} color={colors[connectionQuality]} />
        )}
        <span style={{ color: colors[connectionQuality] }}>{labels[connectionQuality]}</span>
      </div>
    );
  };

  // ─── RENDER ────────────────────────────────────────────────

  return (
    <div className="enter-chat-transition" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Hidden audio element for reliable remote audio playback */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Header */}
      <div className="glass" style={{ height: '72px', display: 'flex', alignItems: 'center', padding: '0 1.5rem', justifyContent: 'space-between', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn btn-icon-only" style={{ background: 'rgba(255,255,255,0.05)', display: window.innerWidth <= 768 ? 'flex' : 'none' }} onClick={onBack}>
            <ChevronLeft size={24} />
          </button>
          <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'var(--gradient-premium)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '1.2rem', color: 'white' }}>
            {chatName && chatName.length > 0 ? chatName[0].toUpperCase() : primaryTarget[0]}
          </div>
          <div>
            <h3 style={{ fontSize: '1.1rem', margin: 0, fontWeight: 700 }}>{chatName}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Online</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button className="btn btn-icon-only glass" onClick={() => initiateCall('audio')} style={{ width: '44px', height: '44px', borderRadius: '12px' }}>
            <Phone size={20} color="var(--primary-accent)" />
          </button>
          <button className="btn btn-icon-only btn-primary" onClick={() => initiateCall('video')} style={{ width: '44px', height: '44px', borderRadius: '12px' }}>
            <Video size={20} />
          </button>
          <button className="btn btn-icon-only glass" style={{ width: '44px', height: '44px', borderRadius: '12px' }}>
            <MoreVertical size={20} />
          </button>
        </div>
      </div>

      {/* Message List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
        {messages.map((msg, i) => (
          <div key={i} className={`message-bubble ${msg.sender === 'me' ? 'message-mine' : 'message-theirs'}`}>
            {msg.text && msg.text.startsWith('data:image/') ? (
              <img src={msg.text} alt="Shared update" style={{ maxWidth: '100%', borderRadius: '12px', display: 'block' }} />
            ) : (
              <div style={{ fontSize: '0.95rem', fontWeight: 400, wordBreak: 'break-word' }}>{msg.text}</div>
            )}
            <div style={{ fontSize: '0.6rem', opacity: 0.4, marginTop: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="glass" style={{ padding: '1.2rem 1.5rem', position: 'relative', borderTop: 'none' }}>
        <form onSubmit={sendMessage} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button type="button" className="icon-btn" style={{ color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }} onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
            <Smile size={26} />
          </button>
          <button type="button" className="icon-btn" style={{ color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={26} />
          </button>
          <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleImageUpload} />
          <input
            type="text"
            className="input-premium"
            style={{ flex: 1, borderRadius: '24px', padding: '0.9rem 1.4rem' }}
            placeholder="Write a message..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-icon-only" style={{ borderRadius: '50%', width: '52px', height: '52px', background: 'var(--gradient-premium)' }}>
            <Send size={22} fill="white" />
          </button>
        </form>
        {showEmojiPicker && (
          <div style={{ position: 'absolute', bottom: '100%', left: '1.5rem', transform: 'translateY(-15px)', zIndex: 1000, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
            <EmojiPicker onEmojiClick={(e) => setInputMessage(prev => prev + e.emoji)} theme="dark" width={320} height={400} />
          </div>
        )}
      </div>

      {/* ─── Call Overlay ─── */}
      {callState !== 'idle' && (
        <div className="animate-slide-up" style={{ position: 'absolute', inset: 0, zIndex: 2000, background: '#000', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {callState === 'in-call' ? (
              <>
                {/* Remote video — NOT muted for audio playback through element */}
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                    display: activeCallType === 'video' ? 'block' : 'none'
                  }}
                />

                {/* Audio-only avatar */}
                {activeCallType !== 'video' && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="pulse-anim" style={{ width: '160px', height: '160px', borderRadius: '50px', background: 'var(--gradient-premium)', marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 30px 60px var(--primary-glow)' }}>
                      <UserIcon size={90} color="white" />
                    </div>
                  </div>
                )}

                {/* Local camera PIP */}
                {activeCallType === 'video' && !isVideoOff && (
                  <div style={{ position: 'absolute', top: '2rem', right: '2rem', width: '130px', height: '190px', borderRadius: '24px', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.15)', boxShadow: '0 20px 40px rgba(0,0,0,1)' }}>
                    <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}

                {/* Top HUD: name + timer + quality */}
                <div style={{ position: 'absolute', top: '3rem', left: 0, right: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                  <h2 style={{ fontSize: '2.2rem', fontWeight: 800, textShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>{chatName}</h2>
                  <div className="call-timer" style={{ display: 'inline-block', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', padding: '0.4rem 1.2rem', borderRadius: '99px' }}>
                    {formatTime(callDuration)}
                  </div>
                  <QualityIndicator />
                </div>

                {/* Reconnecting overlay */}
                {connectionQuality === 'reconnecting' && (
                  <div className="reconnecting-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                    <div style={{ textAlign: 'center' }}>
                      <Loader className="spin" size={40} color="var(--primary-accent)" />
                      <p style={{ marginTop: '1rem', fontSize: '1.2rem', color: 'var(--primary-accent)' }}>Reconnecting...</p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                {/* Local camera PIP during calling/connecting */}
                {activeCallType === 'video' && managerRef.current?.localStream && (
                  <div style={{ position: 'absolute', top: '2rem', right: '2rem', width: '120px', height: '160px', borderRadius: '20px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
                <div className="animate-scale-in" style={{ width: '160px', height: '160px', borderRadius: '50px', background: 'var(--gradient-premium)', margin: '0 auto 3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 30px 60px var(--primary-glow)' }}>
                  <UserIcon size={90} color="white" />
                </div>
                <h2 style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '1rem' }}>{chatName}</h2>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.8rem', color: 'var(--primary-accent)', fontSize: '1.2rem' }}>
                  {callState === 'connecting' ? <Loader className="spin" size={24} /> : null}
                  {callState === 'calling' ? 'Calling...' : 'Connecting...'}
                </div>
              </div>
            )}
          </div>

          {/* Call Controls Bar */}
          <div className="glass" style={{ padding: '1.5rem', paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', border: 'none', background: 'rgba(0,0,0,0.8)', zIndex: 2010 }}>
            <button className="btn btn-icon-only glass" onClick={toggleMute} style={{ width: '64px', height: '64px', borderRadius: '20px' }}>
              {isMuted ? <MicOff size={30} /> : <Mic size={30} />}
            </button>
            <button className="btn btn-danger btn-icon-only" onClick={endCall} style={{ background: 'var(--danger)', width: '76px', height: '76px', borderRadius: '24px' }}>
              <PhoneOff size={34} />
            </button>
            <button className="btn btn-icon-only glass" onClick={toggleVideo} style={{ width: '64px', height: '64px', borderRadius: '20px' }}>
              {isVideoOff ? <VideoOff size={30} /> : <Video size={30} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
