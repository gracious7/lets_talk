/**
 * WebRTCManager — Production-grade WebRTC engine
 * 
 * Handles peer connection lifecycle, ICE restart, TURN fallback,
 * connection health monitoring, and clean media track management.
 * Completely separated from React rendering.
 */

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Free TURN servers from Open Relay Project
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require'
};

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1
};

const STATS_INTERVAL_MS = 5000;
const ICE_RESTART_DELAY_MS = 2000;
const MAX_ICE_RESTARTS = 5;

export default class WebRTCManager {
  constructor() {
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.statsInterval = null;
    this.iceRestartTimer = null;
    this.iceRestartCount = 0;
    this.isDestroyed = false;
    this.isInitiator = false;
    this.callType = 'audio';
    this.pendingCandidates = [];
    this.hasRemoteDescription = false;

    // Callbacks — set by consumer (ChatInterface)
    this.onRemoteStream = null;        // (stream) => void
    this.onLocalStream = null;         // (stream) => void
    this.onConnectionStateChange = null; // (state: 'connecting'|'connected'|'reconnecting'|'failed'|'closed') => void
    this.onIceCandidate = null;        // (candidate) => void
    this.onNegotiationNeeded = null;   // (offer) => void — for ICE restart re-offer
    this.onStatsUpdate = null;         // ({ bitrate, packetLoss, roundTripTime }) => void
    this.onError = null;               // (error) => void
    this.onTrackReceived = null;       // (kind: 'audio'|'video') => void

    this._lastBytesReceived = 0;
    this._lastTimestamp = 0;
  }

  /**
   * Get local media and create the peer connection.
   * Call this FIRST before createOffer/handleOffer.
   */
  async initialize(callType = 'audio') {
    if (this.isDestroyed) return;
    this.callType = callType;
    const requiresVideo = callType === 'video';

    try {
      // Get local media
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: requiresVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
        audio: AUDIO_CONSTRAINTS
      });

      if (this.onLocalStream) {
        this.onLocalStream(this.localStream);
      }

      // Create peer connection
      this._createPeerConnection();

      // Add local tracks
      this.localStream.getTracks().forEach(track => {
        this.pc.addTrack(track, this.localStream);
      });

    } catch (err) {
      if (this.onError) this.onError(err);
      throw err;
    }
  }

  /**
   * Create and return an SDP offer (caller side).
   */
  async createOffer() {
    if (!this.pc) throw new Error('PeerConnection not initialized');
    this.isInitiator = true;

    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: this.callType === 'video'
      });
      await this.pc.setLocalDescription(offer);
      return this.pc.localDescription;
    } catch (err) {
      if (this.onError) this.onError(err);
      throw err;
    }
  }

  /**
   * Handle an incoming SDP offer and return an answer (callee side).
   */
  async handleOffer(offer) {
    if (!this.pc) throw new Error('PeerConnection not initialized');
    this.isInitiator = false;

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      this.hasRemoteDescription = true;
      this._drainPendingCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      return this.pc.localDescription;
    } catch (err) {
      if (this.onError) this.onError(err);
      throw err;
    }
  }

  /**
   * Handle an incoming SDP answer (caller side).
   */
  async handleAnswer(answer) {
    if (!this.pc) return;

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.hasRemoteDescription = true;
      this._drainPendingCandidates();
    } catch (err) {
      console.error('[WebRTCManager] Error setting remote answer:', err);
    }
  }

  /**
   * Add an ICE candidate from the remote peer.
   */
  async addIceCandidate(candidate) {
    if (!candidate) return;

    if (this.pc && this.hasRemoteDescription) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        // Non-fatal: some candidates are expected to fail
        console.warn('[WebRTCManager] ICE candidate error (non-fatal):', err.message);
      }
    } else {
      // Buffer until remote description is set
      this.pendingCandidates.push(candidate);
    }
  }

  /**
   * Toggle local audio track enabled/disabled.
   */
  setMuted(muted) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
    }
  }

  /**
   * Toggle local video track enabled/disabled.
   */
  setVideoEnabled(enabled) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(t => { t.enabled = enabled; });
    }
  }

  /**
   * Clean up everything — call on unmount or call end.
   */
  destroy() {
    this.isDestroyed = true;

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.iceRestartTimer) {
      clearTimeout(this.iceRestartTimer);
      this.iceRestartTimer = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    if (this.pc) {
      // Remove listeners to avoid ghost callbacks
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.onconnectionstatechange = null;
      this.pc.onnegotiationneeded = null;

      this.pc.close();
      this.pc = null;
    }

    this.remoteStream = null;
    this.pendingCandidates = [];
    this.hasRemoteDescription = false;
  }

  // ─── PRIVATE ────────────────────────────────────────────────

  _createPeerConnection() {
    this.pc = new RTCPeerConnection(ICE_SERVERS);
    this.remoteStream = new MediaStream();
    this.hasRemoteDescription = false;
    this.pendingCandidates = [];

    // ─── Track reception ───
    this.pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach(track => {
        this.remoteStream.addTrack(track);
      });

      // Fallback: add track directly if no stream
      if (!event.streams[0]) {
        this.remoteStream.addTrack(event.track);
      }

      if (this.onRemoteStream) {
        this.onRemoteStream(this.remoteStream);
      }

      if (this.onTrackReceived) {
        this.onTrackReceived(event.track.kind);
      }

      // Monitor track lifecycle
      event.track.onended = () => {
        console.warn(`[WebRTCManager] Remote ${event.track.kind} track ended`);
      };

      event.track.onmute = () => {
        console.warn(`[WebRTCManager] Remote ${event.track.kind} track muted`);
      };

      event.track.onunmute = () => {
        console.log(`[WebRTCManager] Remote ${event.track.kind} track unmuted`);
      };
    };

    // ─── ICE candidates ───
    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    // ─── ICE connection state monitoring ───
    this.pc.oniceconnectionstatechange = () => {
      if (this.isDestroyed) return;
      const state = this.pc?.iceConnectionState;
      console.log(`[WebRTCManager] ICE connection state: ${state}`);

      switch (state) {
        case 'checking':
          this._fireConnectionState('connecting');
          break;
        case 'connected':
        case 'completed':
          this.iceRestartCount = 0; // Reset counter on successful connection
          this._fireConnectionState('connected');
          this._startStatsPolling();
          break;
        case 'disconnected':
          this._fireConnectionState('reconnecting');
          this._scheduleIceRestart();
          break;
        case 'failed':
          this._fireConnectionState('reconnecting');
          this._attemptIceRestart();
          break;
        case 'closed':
          this._fireConnectionState('closed');
          break;
      }
    };

    // ─── Overall connection state (more reliable in modern browsers) ───
    this.pc.onconnectionstatechange = () => {
      if (this.isDestroyed) return;
      const state = this.pc?.connectionState;
      console.log(`[WebRTCManager] Connection state: ${state}`);

      if (state === 'failed') {
        this._attemptIceRestart();
      }
    };
  }

  _drainPendingCandidates() {
    if (!this.pc || !this.hasRemoteDescription) return;
    const candidates = [...this.pendingCandidates];
    this.pendingCandidates = [];

    candidates.forEach(async (candidate) => {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTCManager] Drain candidate error:', err.message);
      }
    });
  }

  _fireConnectionState(state) {
    if (this.onConnectionStateChange) {
      this.onConnectionStateChange(state);
    }
  }

  _scheduleIceRestart() {
    // Wait a bit — `disconnected` can be transient (network hiccup)
    if (this.iceRestartTimer) clearTimeout(this.iceRestartTimer);
    this.iceRestartTimer = setTimeout(() => {
      if (this.pc && this.pc.iceConnectionState === 'disconnected') {
        this._attemptIceRestart();
      }
    }, ICE_RESTART_DELAY_MS);
  }

  async _attemptIceRestart() {
    if (this.isDestroyed || !this.pc) return;
    if (this.iceRestartCount >= MAX_ICE_RESTARTS) {
      console.error('[WebRTCManager] Max ICE restarts reached, giving up');
      this._fireConnectionState('failed');
      return;
    }

    this.iceRestartCount++;
    console.log(`[WebRTCManager] Attempting ICE restart #${this.iceRestartCount}`);

    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);

      if (this.onNegotiationNeeded) {
        this.onNegotiationNeeded(this.pc.localDescription);
      }
    } catch (err) {
      console.error('[WebRTCManager] ICE restart failed:', err);
      this._fireConnectionState('failed');
    }
  }

  _startStatsPolling() {
    if (this.statsInterval) return; // Already polling

    this.statsInterval = setInterval(async () => {
      if (!this.pc || this.isDestroyed) {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
        return;
      }

      try {
        const stats = await this.pc.getStats();
        let totalBytesReceived = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let roundTripTime = 0;

        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            totalBytesReceived = report.bytesReceived || 0;
            packetsLost = report.packetsLost || 0;
            packetsReceived = report.packetsReceived || 0;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            roundTripTime = report.currentRoundTripTime || 0;
          }
        });

        const now = Date.now();
        let bitrate = 0;
        if (this._lastTimestamp > 0) {
          const elapsed = (now - this._lastTimestamp) / 1000;
          bitrate = ((totalBytesReceived - this._lastBytesReceived) * 8) / elapsed;
        }
        this._lastBytesReceived = totalBytesReceived;
        this._lastTimestamp = now;

        const packetLossRate = packetsReceived > 0
          ? (packetsLost / (packetsReceived + packetsLost)) * 100
          : 0;

        if (this.onStatsUpdate) {
          this.onStatsUpdate({
            bitrate: Math.round(bitrate),
            packetLoss: Math.round(packetLossRate * 100) / 100,
            roundTripTime: Math.round(roundTripTime * 1000) // ms
          });
        }
      } catch (err) {
        // Stats error is non-fatal
      }
    }, STATS_INTERVAL_MS);
  }
}
