// Free, browser-native speech: Web Speech API recognition + speech synthesis.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
// Spoken-only spellings so the synthetic voice says names correctly.
export const PRONOUNCE = [
  [/\bMicheal\b/g, 'Michael'],
  [/\bAnalaize\b/g, 'Analyze'],
  [/\bQewordly\b/g, 'Keywordly'],
  [/\bQetelligence\b/g, 'Kintelligence'],
];
const forSpeech = (t) => PRONOUNCE.reduce((acc, [re, rep]) => acc.replace(re, rep), t);

export const support = { stt: !!SR, tts: 'speechSynthesis' in window };

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
    // Browsers end recognition after silence; restart while the call is live.
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
    } catch {
      /* already started */
    }
  }

  setLang(lang) {
    if (!this.rec) return;
    this.rec.lang = lang;
    if (this.active) this.rec.abort(); // onend restarts with the new language
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

  // Mobile browsers only allow speech after a user gesture: call this on "Start call".
  unlock() {
    if (!support.tts) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
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
    for (const p of prefer) {
      const v = pool.find((v) => v.name.includes(p));
      if (v) return (this.voice = v);
    }
    const g = gender === 'male' ? /male|man|guy|david|daniel|james|ryan/i : /female|woman|zira|aria|jenny|sonia|samantha|karen/i;
    this.voice = pool.find((v) => g.test(v.name) && !(gender === 'male' && /female/i.test(v.name))) || pool[0] || null;
    return this.voice;
  }

  enqueue(text) {
    if (!text.trim()) return;
    this.queue.push(text.trim());
    if (!this.speaking) this.next();
  }

  next() {
    const text = this.queue.shift();
    if (!text) {
      if (this.speaking) {
        this.speaking = false;
        this.emit('idle');
      }
      return;
    }
    this.speaking = true;
    this.spokenText += ' ' + text;
    this.emit('sentence', text);

    if (!support.tts) {
      // No TTS: simulate talking time so the avatar still animates.
      clearTimeout(this.fallback);
      this.fallback = setTimeout(() => this.next(), Math.max(900, text.split(/\s+/).length * 330));
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
      if (this.current === u) this.next();
    };
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      const word = said.slice(e.charIndex, e.charIndex + (e.charLength || 12)).split(/\s/)[0];
      this.emit('word', word);
    };
    u.onend = done;
    u.onerror = done;
    // Some mobile engines never fire onend; don't get stuck.
    this.watchdog = setTimeout(done, 2500 + text.split(/\s+/).length * 520 / this.rate);
    this.current = u;
    speechSynthesis.speak(u);
  }

  cancel() {
    this.queue = [];
    this.current = null;
    clearTimeout(this.watchdog);
    clearTimeout(this.fallback);
    if (support.tts) speechSynthesis.cancel();
    if (this.speaking) {
      this.speaking = false;
      this.emit('idle');
    }
  }

  resetTranscript() {
    this.spokenText = '';
  }
}
