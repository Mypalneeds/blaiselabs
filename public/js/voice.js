// Speech in and out.
// In:  Web Speech API recognition (free, built into Chrome/Edge/Safari).
// Out: three engines →
//   'browser' : device voices (instant, robotic-ish)
//   'kokoro'  : free open-source neural voice running in the browser (~90 MB one-time download)
//   'eleven'  : ElevenLabs studio voices via /api/tts (needs ELEVENLABS_API_KEY on Netlify)
// Audio engines emit loudness 'level' events so the avatar's mouth follows the real sound.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const support = { stt: !!SR, tts: 'speechSynthesis' in window, audio: !!(window.AudioContext || window.webkitAudioContext) };

// Spoken-only spellings so voices say names correctly (captions keep the real spelling).
export const PRONOUNCE = [
  [/\bMicheal\b/g, 'Michael'],
  [/\bAnalaize\b/g, 'Analyze'],
  [/\bQewordly\b/g, 'Keywordly'],
  [/\bQetelligence\b/g, 'Kintelligence'],
  [/\bOsas\b/g, 'Oh-sas'],
];
const forSpeech = (t) => PRONOUNCE.reduce((acc, [re, rep]) => acc.replace(re, rep), t);

// ---------------------------------------------------------------- Listener
export class Listener extends EventTarget {
  constructor(lang = 'en-US') {
    super();
    this.active = false;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim.trim()) this.emit('interim', interim.trim());
      if (final.trim()) this.emit('final', final.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.active = false;
      if (e.error !== 'no-speech' && e.error !== 'aborted') this.emit('error', e.error);
    };
    rec.onend = () => {
      if (this.active) setTimeout(() => this.active && this.safeStart(), 150);
    };
    this.rec = rec;
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  safeStart() {
    try {
      this.rec.start();
    } catch {}
  }
  setLang(lang) {
    if (!this.rec) return;
    this.rec.lang = lang;
    if (this.active) this.rec.abort();
  }
  start() {
    if (!this.rec) return;
    this.active = true;
    this.safeStart();
  }
  stop() {
    this.active = false;
    try {
      this.rec?.abort();
    } catch {}
  }
}

// ---------------------------------------------------------------- Kokoro (free neural voice)
class Kokoro extends EventTarget {
  constructor() {
    super();
    this.state = 'off'; // off | loading | ready | failed
    this.jobs = new Map();
    this.seq = 0;
  }
  load() {
    if (this.state === 'loading' || this.state === 'ready') return this.ready;
    this.state = 'loading';
    this.worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') this.dispatchEvent(new CustomEvent('progress', { detail: m.loaded / m.total }));
        else if (m.type === 'ready') {
          this.state = 'ready';
          this.dispatchEvent(new CustomEvent('ready', { detail: m.device }));
          resolve();
        } else if (m.type === 'audio' || m.type === 'error') {
          const job = this.jobs.get(m.id);
          if (!job) {
            if (m.type === 'error' && this.state === 'loading') {
              this.state = 'failed';
              reject(new Error(m.error));
            }
            return;
          }
          this.jobs.delete(m.id);
          m.type === 'audio' ? job.resolve(m) : job.reject(new Error(m.error));
        }
      };
      this.worker.onerror = (e) => {
        this.state = 'failed';
        reject(new Error(e.message || 'worker failed'));
      };
    });
    this.worker.postMessage({ type: 'load' });
    return this.ready;
  }
  speak(text, voice, speed) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'speak', id, text, voice, speed });
    });
  }
}
export const kokoro = new Kokoro();

// ---------------------------------------------------------------- Speaker
export class Speaker extends EventTarget {
  constructor() {
    super();
    this.queue = [];
    this.speaking = false;
    this.voice = null;
    this.pitch = 1;
    this.rate = 1;
    this.spokenText = '';
    this.voices = [];
    this.engine = 'browser';
    this.persona = null;
    this.gen = 0; // bumps on cancel so stale audio never plays
    this.cache = new Map();
    if (support.tts) {
      const load = () => {
        this.voices = speechSynthesis.getVoices();
        this.emit('voices', this.voices);
      };
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  ctx() {
    if (!this.ac && support.audio) {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ac.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ac.destination);
      this.buf = new Float32Array(this.analyser.fftSize);
    }
    return this.ac;
  }

  // Mobile browsers only allow audio after a user gesture: call on "Talk".
  unlock() {
    if (support.tts) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
    const ac = this.ctx();
    if (ac?.state === 'suspended') ac.resume();
  }

  setEngine(engine, persona) {
    this.engine = engine;
    this.persona = persona;
    this.cache.clear();
  }

  pickVoice({ prefer = [], gender, pitch = 1, rate = 1 }, lang = 'en-US', forcedName) {
    this.pitch = pitch;
    this.rate = rate;
    const voices = this.voices.length ? this.voices : support.tts ? speechSynthesis.getVoices() : [];
    if (forcedName) {
      const v = voices.find((v) => v.name === forcedName);
      if (v) return (this.voice = v);
    }
    const base = lang.split('-')[0];
    const sameLang = voices.filter((v) => v.lang?.toLowerCase().startsWith(base));
    const pool = sameLang.length ? sameLang : voices;
    // Prefer higher-quality "Natural"/"Neural"/"Enhanced"/"Premium" voices when present.
    const quality = pool.filter((v) => /natural|neural|enhanced|premium|online/i.test(v.name));
    for (const set of [quality, pool]) {
      for (const p of prefer) {
        const v = set.find((v) => v.name.includes(p));
        if (v) return (this.voice = v);
      }
    }
    const g = gender === 'male' ? /male|man|guy|david|daniel|james|ryan|andrew|brian/i : /female|woman|zira|aria|jenny|sonia|samantha|karen|ava|emma/i;
    const ok = (v) => g.test(v.name) && !(gender === 'male' && /female/i.test(v.name));
    this.voice = quality.find(ok) || pool.find(ok) || pool[0] || null;
    return this.voice;
  }

  // Synthesize (audio engines) → AudioBuffer
  async synth(text) {
    const ac = this.ctx();
    const said = forSpeech(text);
    if (this.cache.has(said)) return this.cache.get(said);
    let buffer;
    if (this.engine === 'kokoro') {
      const p = this.persona?.voice;
      const { audio, sr } = await kokoro.speak(said, p?.kokoro || 'af_heart', p?.kokoroSpeed || 1);
      buffer = ac.createBuffer(1, audio.length, sr);
      buffer.copyToChannel(audio, 0);
    } else {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: said, persona: this.persona?.id }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      buffer = await ac.decodeAudioData(await res.arrayBuffer());
    }
    return buffer;
  }

  // Pre-render short phrases (fillers) so they play instantly.
  async prepare(phrases) {
    if (this.engine === 'browser') return;
    for (const t of phrases) {
      try {
        this.cache.set(forSpeech(t), await this.synth(t));
      } catch {
        return;
      }
    }
  }

  // Can this phrase play instantly?
  isReady(text) {
    return this.engine === 'browser' || this.cache.has(forSpeech(text));
  }

  enqueue(text) {
    text = text.trim();
    if (!text) return;
    const item = { text };
    if (this.engine !== 'browser') item.audio = this.synth(text).catch(() => null);
    this.queue.push(item);
    if (!this.speaking) this.next();
  }

  async next() {
    const item = this.queue.shift();
    if (!item) {
      if (this.speaking) {
        this.speaking = false;
        this.emit('idle');
      }
      return;
    }
    this.speaking = true;
    const gen = this.gen;

    if (item.audio) {
      const buffer = await item.audio;
      if (gen !== this.gen) return; // cancelled while synthesizing
      if (buffer) return this.playBuffer(item.text, buffer, gen);
      // synthesis failed → fall back to the device voice for this sentence
    }
    this.speakBrowser(item.text, gen);
  }

  playBuffer(text, buffer, gen) {
    const ac = this.ctx();
    if (ac.state === 'suspended') ac.resume();
    this.spokenText += ' ' + text;
    this.emit('sentence', text);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);
    this.source = src;
    const tick = () => {
      if (this.source !== src) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const rms = Math.sqrt(sum / this.buf.length);
      this.emit('level', Math.min(1, rms * 5));
      this.raf = requestAnimationFrame(tick);
    };
    src.onended = () => {
      if (this.source === src) this.source = null;
      cancelAnimationFrame(this.raf);
      if (gen === this.gen) this.next();
    };
    src.start();
    tick();
  }

  speakBrowser(text, gen) {
    this.spokenText += ' ' + text;
    this.emit('sentence', text);
    if (!support.tts) {
      clearTimeout(this.fallback);
      this.fallback = setTimeout(() => gen === this.gen && this.next(), Math.max(900, text.split(/\s+/).length * 330));
      return;
    }
    const said = forSpeech(text);
    const u = new SpeechSynthesisUtterance(said);
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    }
    u.pitch = this.pitch;
    u.rate = this.rate;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(this.watchdog);
      if (this.current === u && gen === this.gen) this.next();
    };
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      this.emit('word', said.slice(e.charIndex, e.charIndex + (e.charLength || 12)).split(/\s/)[0]);
    };
    u.onend = done;
    u.onerror = done;
    this.watchdog = setTimeout(done, 2500 + (said.split(/\s+/).length * 520) / this.rate);
    this.current = u;
    speechSynthesis.speak(u);
  }

  cancel() {
    this.gen++;
    this.queue = [];
    this.current = null;
    clearTimeout(this.watchdog);
    clearTimeout(this.fallback);
    cancelAnimationFrame(this.raf);
    if (support.tts) speechSynthesis.cancel();
    if (this.source) {
      try {
        this.source.stop();
      } catch {}
      this.source = null;
    }
    if (this.speaking) {
      this.speaking = false;
      this.emit('idle');
    }
  }

  resetTranscript() {
    this.spokenText = '';
  }
}
