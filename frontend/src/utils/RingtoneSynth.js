export default class RingtoneSynth {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.currentTimers = [];
    this.activeNodes = [];
  }
  
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playRingin() {
    this.stop();
    this.init();
    this.isPlaying = true;
    
    const playCycle = () => {
      if (!this.isPlaying) return;
      
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc1.type = 'square';
      osc2.type = 'sine';
      osc1.frequency.value = 523.25; 
      osc2.frequency.value = 659.25; 
      
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 0.05); 
      gain.gain.setValueAtTime(0.1, this.ctx.currentTime + 0.4);           
      gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.45);   
      
      gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 0.65); 
      gain.gain.setValueAtTime(0.1, this.ctx.currentTime + 1.05);          
      gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.1);    
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc1.start();
      osc2.start();
      osc1.stop(this.ctx.currentTime + 1.2);
      osc2.stop(this.ctx.currentTime + 1.2);
      
      this.activeNodes.push({ osc1, osc2, gain });
      this.currentTimers.push(setTimeout(playCycle, 3000));
    };
    playCycle();
  }
  
  playRingout() {
    this.stop();
    this.init();
    this.isPlaying = true;
    
    const playCycle = () => {
      if (!this.isPlaying) return;
      
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime + 1.95);
      gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 2.0);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc1.start();
      osc2.start();
      osc1.stop(this.ctx.currentTime + 2.0);
      osc2.stop(this.ctx.currentTime + 2.0);
      
      this.activeNodes.push({ osc1, osc2, gain });
      this.currentTimers.push(setTimeout(playCycle, 6000));
    };
    playCycle();
  }

  stop() {
    this.isPlaying = false;
    this.currentTimers.forEach(clearTimeout);
    this.currentTimers = [];
    this.activeNodes.forEach(nodes => {
      try { nodes.osc1.stop(); } catch(e) {}
      try { nodes.osc2.stop(); } catch(e) {}
    });
    this.activeNodes = [];
  }
}
