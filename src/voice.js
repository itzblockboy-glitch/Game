/**
 * Voice chat: mesh WebRTC with Opus tuned for ~10-16 kbit/s, VAD gating so silence
 * costs zero, push-to-talk, and spatialised 3D playback for nearby players.
 */
export class VoiceChat {
  constructor(network, handlers = {}) {
    this.net = network;
    this.peers = new Map(); // id -> { pc, audio, analyser, source, gain, spatial }
    this.localStream = null;
    this.enabled = false;
    this.muted = false;
    this.pushToTalk = false;
    this.holdingPTT = false;
    this.vadThreshold = 0.045;
    this.spatial = true;
    this.volume = 1;
    this.onLevel = handlers.onLevel || (() => {});
    this.onPeers = handlers.onPeers || (() => {});
    this.onVad = handlers.onVad || (() => {});
    this.myLevel = 0;
    this.speaking = false;
    this._raf = null;
    this._audioCtx = null;

    network.on('signal', (msg) => this._handleSignal(msg));
    network.on('join', (msg) => {
      if (!this.enabled) return;
      // existing peers create the offer to newcomers
      if (msg.id !== network.myId) this._ensurePeer(msg.id, true);
    });
    network.on('leave', (msg) => this._dropPeer(msg.id));
    network.on('welcome', () => {
      if (this.enabled) this._announceReady();
    });
  }

  async enable() {
    if (this.enabled) return true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
    } catch (err) {
      console.warn('microphone unavailable', err);
      return false;
    }
    this._audioCtx = this._audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
    this.enabled = true;
    this._startMeter();
    this._announceReady();
    // connect to everyone already in the room
    for (const id of this.net.players.keys()) {
      if (id !== this.net.myId) this._ensurePeer(id, true);
    }
    return true;
  }

  disable() {
    this.enabled = false;
    for (const id of [...this.peers.keys()]) this._dropPeer(id);
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    cancelAnimationFrame(this._raf);
  }

  setMuted(m) {
    this.muted = m;
    if (this.localStream) for (const t of this.localStream.getAudioTracks()) t.enabled = !m;
    this.net.signal({ t: 'mute', muted: m });
  }

  setPushToTalk(on) {
    this.pushToTalk = on;
    if (!on && this.localStream) {
      for (const t of this.localStream.getAudioTracks()) t.enabled = !this.muted;
    }
  }

  setHoldPTT(down) {
    if (!this.pushToTalk) return;
    this.holdingPTT = down;
    if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) t.enabled = down && !this.muted;
    }
  }

  _announceReady() {
    this.net.signal({ t: 'voice-ready' });
  }

  _handleSignal(msg) {
    if (!this.enabled) return;
    const id = msg.from;
    if (!id || id === this.net.myId) return;
    switch (msg.t) {
      case 'voice-ready':
        this._ensurePeer(id, true);
        break;
      case 'offer':
        this._ensurePeer(id, false).then((p) => p && this._acceptOffer(p, msg));
        break;
      case 'answer':
        this._onAnswer(msg);
        break;
      case 'ice':
        this._onIce(msg);
        break;
      case 'mute':
        this._setPeerMute(id, !!msg.muted);
        break;
      default:
        break;
    }
  }

  async _ensurePeer(id, initiator) {
    if (this.peers.has(id)) return this.peers.get(id);
    if (!this.enabled) return null;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    const peer = { pc, audio: null, gain: null, analyser: null, id };
    this.peers.set(id, peer);

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.signal({ t: 'ice', target: id, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      const audio = new Audio();
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = this.volume;
      peer.audio = audio;
      audio.play().catch(() => {});
      // spatial gain node
      try {
        const ctx = this._audioCtx || (this._audioCtx = new (window.AudioContext || window.webkitAudioContext)());
        const src = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = 1;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(gain);
        gain.connect(ctx.destination);
        // mute the raw element and use the graph instead
        audio.volume = 0;
        peer.gain = gain;
        peer.analyser = analyser;
        peer.source = src;
      } catch {}
      this.onPeers(this.peers.size);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        // let it retry naturally; only drop on failed
        if (pc.connectionState === 'failed') this._dropPeer(id);
      }
    };

    this.onPeers(this.peers.size);

    if (initiator) {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      // tune Opus for low bitrate: 16 kbps mono + DTX
      offer.sdp = squashOpus(offer.sdp, { bitrate: 16000, dtx: true, fec: true });
      await pc.setLocalDescription(offer);
      this.net.signal({ t: 'offer', target: id, sdp: offer.sdp, type: offer.type });
    }
    return peer;
  }

  async _acceptOffer(peer, msg) {
    const pc = peer.pc;
    if (pc.signalingState !== 'stable' && pc.remoteDescription) return;
    try {
      await pc.setRemoteDescription({ type: msg.type, sdp: msg.sdp });
      const answer = await pc.createAnswer();
      answer.sdp = squashOpus(answer.sdp, { bitrate: 16000, dtx: true, fec: true });
      if (answer.sdp) {
        await pc.setLocalDescription(answer);
        this.net.signal({ t: 'answer', target: peer.id, sdp: answer.sdp, type: answer.type });
      }
    } catch (err) {
      console.warn('voice offer failed', err);
    }
  }

  async _onAnswer(msg) {
    const peer = this.peers.get(msg.from);
    if (!peer) return;
    if (peer.pc.signalingState === 'have-local-offer') {
      try {
        await peer.pc.setRemoteDescription({ type: msg.type, sdp: msg.sdp });
      } catch (err) {
        console.warn('voice answer failed', err);
      }
    }
  }

  async _onIce(msg) {
    const peer = this.peers.get(msg.from);
    if (!peer || !msg.candidate) return;
    try {
      await peer.pc.addIceCandidate(msg.candidate);
    } catch {}
  }

  _setPeerMute(id, muted) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (peer.gain) peer.gain.gain.value = muted ? 0 : 1;
  }

  _dropPeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    try {
      peer.pc.close();
    } catch {}
    if (peer.audio) peer.audio.srcObject = null;
    this.peers.delete(id);
    this.onPeers(this.peers.size);
  }

  _startMeter() {
    if (!this.localStream || !this._audioCtx) return;
    const src = this._audioCtx.createMediaStreamSource(this.localStream);
    const analyser = this._audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 2; i < 40; i++) sum += data[i];
      const level = sum / (38 * 255);
      this.myLevel = level;
      const speaking = level > this.vadThreshold;
      if (speaking !== this.speaking) {
        this.speaking = speaking;
        this.onVad(speaking);
      }
      this.onLevel(level);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  /** per-frame spatialisation: pan/attenuate by distance to each peer */
  updateSpatial(listenerPos, listenerYaw, peerPositions) {
    if (!this._audioCtx) return;
    const ctx = this._audioCtx;
    for (const [id, peer] of this.peers) {
      if (!peer.audio) continue;
      const p = peerPositions?.get(id);
      if (!p) continue;
      const dx = p.x - listenerPos.x;
      const dz = p.z - listenerPos.z;
      const dist = Math.hypot(dx, dz);
      const att = this.spatial ? 1 / (1 + Math.pow(dist / 9, 1.7)) : 1;
      const vol = Math.max(0, Math.min(1, att * this.volume));
      // stereo pan from relative bearing
      const bearing = Math.atan2(dx, dz) - listenerYaw;
      const pan = this.spatial ? Math.max(-1, Math.min(1, Math.sin(bearing) * 0.9)) : 0;
      if (peer.stereo) peer.stereo.pan.value = pan;
      else if (peer.gain && peer.pan === undefined) {
        try {
          const panner = ctx.createStereoPanner();
          peer.gain.disconnect();
          peer.gain.connect(panner);
          panner.connect(ctx.destination);
          peer.stereo = panner;
          peer.stereo.pan.value = pan;
        } catch {}
      }
      if (peer.gain) peer.gain.gain.value = peer.muted ? 0 : vol;
      if (peer.audio) peer.audio.volume = 0;
    }
  }

  stats() {
    return {
      enabled: this.enabled,
      peers: this.peers.size,
      speaking: this.speaking,
      level: this.myLevel,
      bitrate: this.enabled ? 16 : 0,
    };
  }
}

/** Force Opus mono / low bitrate / DTX into an SDP */
function squashOpus(sdp, { bitrate = 16000, dtx = true, fec = true } = {}) {
  if (!sdp) return sdp;
  const params = ['stereo=0', 'sprop-stereo=0', `maxaveragebitrate=${bitrate}`, 'useinbandfec=1', 'minptime=20'];
  if (dtx) params.push('usedtx=1');
  if (!fec) params.push('useinbandfec=0');
  return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*opus[^\r\n]*)/gi, (m, pt, rest) => {
    if (/opus/i.test(rest)) return `a=fmtp:${pt} ${params.join(';')}`;
    return m;
  });
}
