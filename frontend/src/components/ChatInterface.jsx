import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Smile, Paperclip, Phone, Video, X, Mic, MicOff, VideoOff, PhoneOff, User as UserIcon, MoreVertical, ChevronLeft, Loader } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import RingtoneSynth from '../utils/RingtoneSynth';

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true, 
  autoGainControl: true
};

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

  const pcRef = useRef();
  const localStreamRef = useRef();
  const remoteStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioGainNodeRef = useRef(null);
  const ringSynthRef = useRef(new RingtoneSynth());
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const messagesEndRef = useRef();
  const timerIntervalRef = useRef();

  // Load chat history
  useEffect(() => {
    const participants = [myNumber, ...targetNumbers].sort();
    const storageKey = `chat_history_${participants.join('_')}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) setMessages(JSON.parse(stored));
  }, [myNumber, targetNumbers]);

  // Save chat history
  useEffect(() => {
    const participants = [myNumber, ...targetNumbers].sort();
    const storageKey = `chat_history_${participants.join('_')}`;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, myNumber, targetNumbers]);

  // Audio track cleanup on unmount
  useEffect(() => {
    return () => {
      ringSynthRef.current.stop();
    };
  }, []);

  // Bind video streams properly when they mount during in-call state
  useEffect(() => {
    if (callState === 'in-call') {
      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      if (remoteVideoRef.current && remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
    }
  }, [callState, isVideoOff, activeCallType]);

  const initAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      audioGainNodeRef.current = audioContextRef.current.createGain();
      audioGainNodeRef.current.connect(audioContextRef.current.destination);
    }
    if (audioContextRef.current.state === 'suspended') {
      try { await audioContextRef.current.resume(); } catch (e) { console.warn('Could not resume AudioContext', e); }
    }
  };

  const setupAudioPipeline = (stream) => {
    if (!audioContextRef.current || !stream.getAudioTracks().length) return;
    if (audioSourceRef.current) audioSourceRef.current.disconnect();
    audioSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
    audioGainNodeRef.current.gain.value = 1.0; 
    audioSourceRef.current.connect(audioGainNodeRef.current);
  };

  const optimizeSDP = (sdp) => {
    let lines = sdp.split('\r\n');
    return lines.map(line => {
      if (line.includes('a=fmtp:111')) {
        return line + ';maxaveragebitrate=64000;stereo=0;sprop-stereo=0;useinbandfec=1;usedtx=0;cbr=1;ptime=20';
      }
      return line;
    }).join('\r\n');
  };

  const pendingCandidatesRef = useRef([]);

  const startWebRTC = useCallback(async (isInitiator, type, existingOffer = null) => {
    try {
      await initAudioContext();
      const requiresVideo = type === 'video';
      setIsVideoOff(!requiresVideo);
      setActiveCallType(type);

      // Get media FIRST — before any state updates or DOM changes
      const stream = await navigator.mediaDevices.getUserMedia({
        video: requiresVideo,
        audio: AUDIO_CONSTRAINTS,
      });
      localStreamRef.current = stream;

      // Assign to local video element immediately (works if overlay is already rendered)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Now transition to connecting state (overlay renders)
      setCallState('connecting');

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pendingCandidatesRef.current = [];

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;

      // Track reception — most critical fix
      pc.ontrack = (event) => {
        remoteStream.addTrack(event.track);
        ringSynthRef.current.stop();

        // Bind remote video element immediately
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }

        if (event.track.kind === 'audio') {
          setupAudioPipeline(remoteStream);
        }

        // Transition to in-call on first track
        setCallState('in-call');
        startTimer();
      };

      // Add local tracks to peer connection
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      if (isInitiator) {
        const offer = await pc.createOffer();
        const optimizedOffer = new RTCSessionDescription({ type: 'offer', sdp: optimizeSDP(offer.sdp) });
        await pc.setLocalDescription(optimizedOffer);
        socket.emit('call-offer', { targetNumbers, offer: optimizedOffer, callType: type });
      } else if (existingOffer) {
        await pc.setRemoteDescription(new RTCSessionDescription(existingOffer));
        // Drain any buffered candidates
        for (const c of pendingCandidatesRef.current) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
        }
        pendingCandidatesRef.current = [];
        const answer = await pc.createAnswer();
        const optimizedAnswer = new RTCSessionDescription({ type: 'answer', sdp: optimizeSDP(answer.sdp) });
        await pc.setLocalDescription(optimizedAnswer);
        socket.emit('call-answer', { targetNumbers: [primaryTarget], answer: optimizedAnswer });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', { targetNumbers: isInitiator ? targetNumbers : [primaryTarget], candidate: event.candidate });
        }
      };

    } catch (err) {
      console.error('WebRTC Error:', err);
      alert(`Could not start call. Error: ${err.message}`);
      endCallLocally();
    }
  }, [socket, targetNumbers, primaryTarget]);

  // Initiator: Just start ringing, don't start WebRTC yet
  const initiateCall = (type) => {
    setActiveCallType(type);
    setCallState('calling');
    ringSynthRef.current.playRingout();
    socket.emit('initiate-call', { targetNumbers, callType: type });
  };

  // Receiver: Accepting happens in Dashboard, then we land here with autoAcceptData
  useEffect(() => {
    if (autoAcceptData) {
      // If we land here, the receiver already clicked "Accept"
      socket.emit('accept-call', { targetNumber: primaryTarget });
      // We don't start WebRTC immediately as receiver, we wait for the Initiator's offer
      setCallState('connecting');
    }
  }, [autoAcceptData, primaryTarget, socket]);

  useEffect(() => {
    const handleCallOffer = (data) => {
      // Only handle if we are expecting a call from this number or in connecting state
      if (data.callerNumber === primaryTarget) {
        startWebRTC(false, data.callType, data.offer);
      }
    };

    const handleCallAccepted = () => {
      if (callState === 'calling') {
        ringSynthRef.current.stop();
        // Initiator: Now receiver has accepted, let's negotiate WebRTC
        startWebRTC(true, activeCallType);
      }
    };

    const handleIceCandidate = async (data) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("ICE error", e);
        }
      } else {
        // Buffer candidates that arrive before remoteDescription is set
        pendingCandidatesRef.current.push(data.candidate);
      }
    };

    const handleCallAnswer = async (data) => {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        // Drain buffered ICE candidates now that remote description is set
        for (const c of pendingCandidatesRef.current) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
        }
        pendingCandidatesRef.current = [];
      }
    };

    const handleCallRejected = () => {
      alert("Call was rejected");
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
    socket.on('call-ended', () => endCallLocally());
    socket.on('receive-message', handleReceiveMessage);

    return () => {
      socket.off('call-offer', handleCallOffer);
      socket.off('call-accepted', handleCallAccepted);
      socket.off('call-answer', handleCallAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('call-rejected', handleCallRejected);
      socket.off('call-ended');
      socket.off('receive-message', handleReceiveMessage);
    };
  }, [socket, primaryTarget, callState, activeCallType, startWebRTC]);

  const endCallLocally = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    setCallState('idle');
    stopTimer();
    ringSynthRef.current.stop();
  };

  const startTimer = () => {
    setCallDuration(0);
    timerIntervalRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

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

  return (
    <div className="enter-chat-transition" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Header */}
      <div className="glass" style={{ height: '72px', display: 'flex', alignItems: 'center', padding: '0 1.5rem', justifyContent: 'space-between', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button className="btn btn-icon-only" style={{ background: 'rgba(255,255,255,0.05)', display: window.innerWidth <= 768 ? 'flex' : 'none' }} onClick={onBack}>
            <ChevronLeft size={24} />
          </button>
          <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'var(--gradient-premium)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '1.2rem', color: 'white' }}>
            {chatName[0].toUpperCase()}
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

      {/* Unique Message List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
        {messages.map((msg, i) => (
          <div key={i} className={`message-bubble ${msg.sender === 'me' ? 'message-mine' : 'message-theirs'}`}>
            <div style={{ fontSize: '0.95rem', fontWeight: 400 }}>{msg.text}</div>
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
          <button type="button" className="icon-btn" style={{ color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <Paperclip size={26} />
          </button>
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

      {/* Call Overlays */}
      {(callState !== 'idle') && (
        <div className="animate-slide-up" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#000', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {callState === 'in-call' ? (
              <>
                {/* Remote video - NOT muted so audio plays */}
                <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: activeCallType === 'video' ? 'block' : 'none' }} />
                
                {/* Fallback Avatar for Audio Calls */}
                {activeCallType !== 'video' && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="animate-scale-in" style={{ width: '160px', height: '160px', borderRadius: '50px', background: 'var(--gradient-premium)', marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 30px 60px var(--primary-glow)' }}>
                      <UserIcon size={90} color="white" />
                    </div>
                  </div>
                )}

                {/* Local camera preview (top right pip) */}
                {activeCallType === 'video' && (
                  <div style={{ position: 'absolute', top: '2rem', right: '2rem', width: '130px', height: '190px', borderRadius: '24px', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.15)', boxShadow: '0 20px 40px rgba(0,0,0,1)', display: isVideoOff ? 'none' : 'block' }}>
                    <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
                <div style={{ position: 'absolute', top: '3rem', left: '0', right: '0', textAlign: 'center' }}>
                  <h2 style={{ fontSize: '2.2rem', fontWeight: 800, textShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>{chatName}</h2>
                  <div className="call-timer" style={{ display: 'inline-block', marginTop: '1rem', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', padding: '0.4rem 1.2rem', borderRadius: '99px' }}>
                    {formatTime(callDuration)}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                {/* Show local camera preview in small pip during calling/connecting too */}
                {activeCallType === 'video' && localStreamRef.current && (
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
          <div className="glass" style={{ height: '140px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '2.5rem', border: 'none', background: 'rgba(0,0,0,0.7)' }}>
            <button className="btn btn-icon-only glass" onClick={() => {
              if (localStreamRef.current) {
                localStreamRef.current.getAudioTracks().forEach(t => t.enabled = isMuted);
              }
              setIsMuted(!isMuted);
            }} style={{ width: '60px', height: '60px', borderRadius: '20px' }}>
              {isMuted ? <MicOff size={28} /> : <Mic size={28} />}
            </button>
            <button className="btn btn-icon-only glass" onClick={() => {
              if (localStreamRef.current) {
                localStreamRef.current.getVideoTracks().forEach(t => t.enabled = isVideoOff);
              }
              setIsVideoOff(!isVideoOff);
            }} style={{ width: '60px', height: '60px', borderRadius: '20px' }}>
              {isVideoOff ? <VideoOff size={28} /> : <Video size={28} />}
            </button>
            <button className="btn btn-danger btn-icon-only" onClick={() => { socket.emit('end-call', { targetNumbers }); endCallLocally(); }} style={{ background: 'var(--danger)', width: '72px', height: '72px', borderRadius: '24px' }}>
              <PhoneOff size={32} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
