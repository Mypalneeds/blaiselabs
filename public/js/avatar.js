// Original stylised SVG avatar with procedural, human-like behaviour:
// 12 emotions, asymmetric brows, micro-expressions, breathing, saccades,
// emphasis on stressed words, audio-driven lip-sync, and mirroring the user's
// face (when the camera is on).

const NS = 'http://www.w3.org/2000/svg';

// smile −1..1 · brow raise · concern (inner brows up) · asym (left brow up / right down)
// eye openness · squint · head tilt (deg) · open (mouth) · blush extra · gaze bias
const EXPRESSIONS = {
  neutral:     { smile: 0.15, brow: 0,    concern: 0,   asym: 0,   eye: 1,    squint: 0,    tilt: 0,  open: 0,    blush: 0,   gx: 0,    gy: 0 },
  happy:       { smile: 0.75, brow: 0.2,  concern: 0,   asym: 0,   eye: 1,    squint: 0.22, tilt: 2,  open: 0,    blush: 0.1, gx: 0,    gy: 0 },
  laugh:       { smile: 1,    brow: 0.35, concern: 0,   asym: 0,   eye: 0.9,  squint: 0.5,  tilt: 5,  open: 0.4,  blush: 0.2, gx: 0,    gy: -0.1 },
  excited:     { smile: 0.95, brow: 0.65, concern: 0,   asym: 0,   eye: 1.18, squint: 0.08, tilt: 3,  open: 0.18, blush: 0.15, gx: 0,   gy: 0 },
  curious:     { smile: 0.25, brow: 0.45, concern: 0,   asym: 0.35, eye: 1.05, squint: 0,   tilt: 8,  open: 0,    blush: 0,   gx: 0,    gy: 0 },
  thinking:    { smile: 0,    brow: 0.2,  concern: 0.25, asym: 0.25, eye: 0.92, squint: 0.12, tilt: -5, open: 0,  blush: 0,   gx: -0.55, gy: -0.6 },
  concerned:   { smile: -0.3, brow: 0.1,  concern: 1,   asym: 0,   eye: 1,    squint: 0.05, tilt: -3, open: 0,    blush: 0,   gx: 0,    gy: 0 },
  sad:         { smile: -0.5, brow: -0.1, concern: 0.95, asym: 0,  eye: 0.82, squint: 0.08, tilt: -6, open: 0,    blush: 0,   gx: 0.1,  gy: 0.45 },
  empathetic:  { smile: 0.22, brow: 0.05, concern: 0.7, asym: 0,   eye: 0.95, squint: 0.12, tilt: 7,  open: 0,    blush: 0.05, gx: 0,   gy: 0.05 },
  surprised:   { smile: 0.1,  brow: 1,    concern: 0,   asym: 0,   eye: 1.3,  squint: 0,    tilt: 0,  open: 0.35, blush: 0,   gx: 0,    gy: 0 },
  skeptical:   { smile: 0.05, brow: 0.1,  concern: 0,   asym: 0.85, eye: 0.95, squint: 0.28, tilt: -4, open: 0,   blush: 0,   gx: 0.2,  gy: 0 },
  embarrassed: { smile: 0.5,  brow: 0.15, concern: 0.3, asym: 0,   eye: 0.9,  squint: 0.3,  tilt: -7, open: 0,    blush: 0.6, gx: 0.6,  gy: 0.4 },
};
export const EMOTIONS = Object.keys(EXPRESSIONS);
const KEYS = ['smile', 'brow', 'concern', 'asym', 'eye', 'squint', 'tilt', 'open', 'blush', 'gx', 'gy'];

// Skin tones users can switch between (by tapping a swatch or asking out loud).
export const SKIN_TONES = {
  porcelain: { label: 'Porcelain', skin: ['#f6dcc8', '#e2b89c'], blush: '#e88a86' },
  light:     { label: 'Light',     skin: ['#eec4a2', '#d39f7c'], blush: '#e07f78' },
  medium:    { label: 'Medium',    skin: ['#d9a37c', '#b67d58'], blush: '#d4706a' },
  tan:       { label: 'Tan',       skin: ['#c69072', '#9c6a4e'], blush: '#c46a5a' },
  brown:     { label: 'Brown',     skin: ['#b9805a', '#8d5b3c'], blush: '#d0625a' },
  dark:      { label: 'Dark',      skin: ['#8a5a3c', '#664028'], blush: '#a8524a' },
  deep:      { label: 'Deep',      skin: ['#62402b', '#45291a'], blush: '#8a4038' },
};

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

export class Avatar {
  constructor(container, look) {
    this.look = look;
    this.mode = 'idle'; // idle | listening | thinking | speaking
    this.target = { ...EXPRESSIONS.neutral };
    this.cur = { ...EXPRESSIONS.neutral, mouth: 0, wide: 0, blink: 1, eyeX: 0, eyeY: 0, headTilt: 0 };
    this.pulses = []; // short additive micro-expressions
    const now = performance.now();
    this.nextBlink = now + 1500;
    this.blinkEnd = 0;
    this.gaze = { x: 0, y: 0 };
    this.saccade = { x: 0, y: 0, next: now };
    this.nextGlance = now + 3000;
    this.nextMicro = now + 2500;
    this.lastNod = 0;
    this.nodStart = 0;
    this.emotion = 'neutral';
    this.emotionUntil = 0;
    this.tiltOffset = 0;
    this.level = 0;
    this.levelAt = 0;
    this.breathStart = 0;
    this.laughUntil = 0;
    this.user = null; // what the camera sees
    this.userMood = { mood: 'none', since: now, reacted: false };
    this.build(container);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  build(container) {
    const L = this.look;
    const u = 'av' + Math.random().toString(36).slice(2, 8);
    const svg = el('svg', { viewBox: '0 0 400 500', class: 'avatar-svg', 'aria-label': `${L.name}, AI persona` });
    const defs = el('defs', {}, svg);

    const bg = el('radialGradient', { id: `${u}bg`, cx: '50%', cy: '35%', r: '75%' }, defs);
    el('stop', { offset: '0%', 'stop-color': L.bg[0] }, bg);
    el('stop', { offset: '100%', 'stop-color': L.bg[1] }, bg);

    const skin = el('radialGradient', { id: `${u}skin`, cx: '45%', cy: '40%', r: '65%' }, defs);
    this.skinStops = [
      el('stop', { offset: '0%', 'stop-color': L.skin[0] }, skin),
      el('stop', { offset: '100%', 'stop-color': L.skin[1] }, skin),
    ];
    this.skinShade = [];

    const eyeClipL = el('clipPath', { id: `${u}eyeClipL` }, defs);
    const eyeClipR = el('clipPath', { id: `${u}eyeClipR` }, defs);
    this.clipL = el('ellipse', { cx: -38, cy: 0, rx: 15, ry: 9 }, eyeClipL);
    this.clipR = el('ellipse', { cx: 38, cy: 0, rx: 15, ry: 9 }, eyeClipR);

    el('rect', { x: 0, y: 0, width: 400, height: 500, fill: `url(#${u}bg)` }, svg);

    // Shoulders (static-ish, slight breathing)
    this.body = el('g', {}, svg);
    el('path', { d: 'M40 520 C60 400 130 370 200 370 C270 370 340 400 360 520 Z', fill: L.shirt }, this.body);
    el('path', { d: 'M170 372 Q200 410 230 372', fill: 'none', stroke: 'rgba(0,0,0,.15)', 'stroke-width': 4 }, this.body);

    // Head group (rotates / nods)
    this.head = el('g', {}, svg);
    this.skinShade.push(el('rect', { x: 178, y: 300, width: 44, height: 80, rx: 18, fill: L.skin[1] }, this.head)); // neck

    if (L.hairBack) el('path', { d: L.hairBack, fill: L.hair }, this.head);

    el('ellipse', { cx: 200, cy: 215, rx: 96, ry: 118, fill: `url(#${u}skin)` }, this.head); // face
    this.skinShade.push(el('ellipse', { cx: 106, cy: 225, rx: 14, ry: 22, fill: L.skin[1] }, this.head)); // ears
    this.skinShade.push(el('ellipse', { cx: 294, cy: 225, rx: 14, ry: 22, fill: L.skin[1] }, this.head));

    // Cheeks (blush grows with smile)
    this.cheekL = el('ellipse', { cx: 140, cy: 262, rx: 20, ry: 12, fill: L.blush, opacity: 0.2 }, this.head);
    this.cheekR = el('ellipse', { cx: 260, cy: 262, rx: 20, ry: 12, fill: L.blush, opacity: 0.2 }, this.head);

    // Eyes
    this.eyes = el('g', { transform: 'translate(200 215)' }, this.head);
    for (const side of ['L', 'R']) {
      const cx = side === 'L' ? -38 : 38;
      const g = el('g', { 'clip-path': `url(#${u}eyeClip${side})` }, this.eyes);
      el('ellipse', { cx, cy: 0, rx: 15, ry: 10, fill: '#fbfaf7' }, g);
      const iris = el('g', {}, g);
      el('circle', { cx, cy: 0, r: 8.5, fill: L.iris }, iris);
      el('circle', { cx, cy: 0, r: 4.2, fill: '#111' }, iris);
      el('circle', { cx: cx + 3, cy: -3, r: 2, fill: '#fff', opacity: 0.9 }, iris);
      this[`iris${side}`] = iris;
      this[`lid${side}`] = el('path', { d: '', fill: 'none', stroke: L.lash, 'stroke-width': 2.6, 'stroke-linecap': 'round' }, this.eyes);
    }

    // Brows
    this.browL = el('path', { d: '', fill: 'none', stroke: L.brow, 'stroke-width': 6, 'stroke-linecap': 'round' }, this.head);
    this.browR = el('path', { d: '', fill: 'none', stroke: L.brow, 'stroke-width': 6, 'stroke-linecap': 'round' }, this.head);

    // Nose
    el('path', { d: 'M200 232 Q194 258 188 266 Q200 272 212 266', fill: 'none', stroke: 'rgba(0,0,0,.18)', 'stroke-width': 3, 'stroke-linecap': 'round' }, this.head);

    // Mouth
    this.mouthG = el('g', { transform: 'translate(200 298)' }, this.head);
    this.mouth = el('path', { d: '', fill: '#5b1f2a' }, this.mouthG);
    this.teeth = el('rect', { x: -12, y: -2, width: 24, height: 5, rx: 2, fill: '#fff', opacity: 0 }, this.mouthG);
    this.lip = el('path', { d: '', fill: 'none', stroke: L.lip, 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, this.mouthG);

    if (L.hairFront) el('path', { d: L.hairFront, fill: L.hair }, this.head);
    if (L.extra) for (const e of L.extra) el(e.tag, e.attrs, this.head);

    container.innerHTML = '';
    container.appendChild(svg);
    this.svg = svg;
  }

  // ---- public API -------------------------------------------------------
  setSkin(name) {
    const tone = SKIN_TONES[name];
    if (!tone) return false;
    this.skinStops[0].setAttribute('stop-color', tone.skin[0]);
    this.skinStops[1].setAttribute('stop-color', tone.skin[1]);
    for (const n of this.skinShade) n.setAttribute('fill', tone.skin[1]);
    this.cheekL.setAttribute('fill', tone.blush);
    this.cheekR.setAttribute('fill', tone.blush);
    return true;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'thinking' && performance.now() > this.emotionUntil) this.setEmotion('thinking', 1500);
    if (mode === 'speaking') this.nextGlance = performance.now() + rand(1200, 2500);
  }

  setEmotion(name, holdMs = 6000) {
    const e = EXPRESSIONS[name];
    if (!e) return;
    this.emotion = name;
    this.target = { ...e };
    this.emotionUntil = performance.now() + holdMs;
    if (name === 'laugh') this.laughUntil = performance.now() + 1400;
    if (name === 'surprised' || name === 'excited') this.flash('brow', 0.3, 400);
  }

  // Short additive twitch: flash('brow', .3, 350) = quick eyebrow raise.
  flash(key, amount, ms = 350) {
    const now = performance.now();
    this.pulses.push({ key, amount, start: now, end: now + ms });
  }

  // While the user talks (interim transcripts): attentive face, occasional nods.
  userPulse(wordCount = 0) {
    const now = performance.now();
    if (this.mode === 'speaking') return;
    if (now > this.emotionUntil) this.target = { ...EXPRESSIONS.neutral, smile: 0.3, brow: 0.12 };
    if (wordCount > 3 && now - this.lastNod > rand(2200, 3600) && Math.random() < 0.45) this.nod(rand(0.5, 1));
    if (Math.random() < 0.06) this.flash('brow', 0.25, 380);
  }

  nod(strength = 1) {
    this.lastNod = performance.now();
    this.nodStart = this.lastNod;
    this.nodStrength = strength;
  }

  // Before a long answer: a visible in-breath.
  breathe() {
    this.breathStart = performance.now();
  }

  // Each sentence: look back at the listener, shift posture a little.
  sentenceStart(text = '') {
    this.gaze = { x: 0, y: 0 };
    this.nextGlance = performance.now() + rand(1500, 3200);
    this.tiltOffset = rand(-3, 3);
    if (Math.random() < 0.35) this.nod(0.35);
    if (/!/.test(text) && Math.random() < 0.6) this.flash('brow', 0.35, 450);
    if (/\?\s*$/.test(text)) {
      this.tiltOffset = rand(4, 7);
      this.flash('brow', 0.25, 600);
    }
  }

  // Word boundary (browser voices): mouth shape + emphasis on longer words.
  viseme(word = '') {
    const w = word.toLowerCase();
    const vowels = (w.match(/[aeiouy]/g) || []).length;
    this.mouthTarget = /^[mbp]/.test(w) ? 0.15 : clamp(0.45 + vowels * 0.12, 0.3, 1);
    this.wideTarget = /[ouw]/.test(w) ? -0.6 : /[ei]/.test(w) ? 0.6 : 0;
    this.lastViseme = performance.now();
    if (w.replace(/[^a-z]/g, '').length > 6 && Math.random() < 0.18) this.flash('brow', 0.22, 300);
    if (w.length > 7 && Math.random() < 0.08) this.nod(0.3);
  }

  // Audio loudness 0..1 (natural/studio voices): drives the jaw directly.
  audioLevel(v) {
    const now = performance.now();
    // Detect syllable onsets for emphasis
    if (v - this.level > 0.35 && Math.random() < 0.05) this.flash('brow', 0.2, 280);
    this.level = v;
    this.levelAt = now;
  }

  speaking(on) {
    this.isSpeaking = on;
    if (!on) {
      this.mouthTarget = 0;
      this.wideTarget = 0;
      this.level = 0;
    }
  }

  // Camera: { present, x, y (−1..1, from viewer's side), mood }
  watchUser(state) {
    this.user = state;
    const now = performance.now();
    const m = state?.present ? state.mood : 'absent';
    if (m !== this.userMood.mood) this.userMood = { mood: m, since: now, reacted: false };
    const held = now - this.userMood.since;
    if (this.userMood.reacted || this.mode === 'speaking' || now < this.emotionUntil - 4000) return;
    // Mirror the user's feelings, like people do.
    if (m === 'smiling' && held > 450) {
      this.setEmotion(Math.random() < 0.3 ? 'laugh' : 'happy', 2200);
      this.userMood.reacted = true;
    } else if (m === 'frowning' && held > 1400) {
      this.setEmotion('empathetic', 2600);
      this.userMood.reacted = true;
    } else if (m === 'surprised' && held > 250) {
      this.setEmotion('surprised', 1200);
      this.userMood.reacted = true;
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  // ---- animation --------------------------------------------------------
  loop(now) {
    const c = this.cur;

    if (now > this.emotionUntil && this.emotion !== 'neutral' && this.mode !== 'thinking') {
      this.emotion = 'neutral';
      this.target = { ...EXPRESSIONS.neutral, smile: this.mode === 'listening' ? 0.25 : 0.15 };
    }

    // Micro-expressions while idle/listening: tiny smiles, brow flicks, swallows
    if (now > this.nextMicro) {
      this.nextMicro = now + rand(1800, 4500);
      if (this.mode !== 'speaking') {
        const r = Math.random();
        if (r < 0.35) this.flash('smile', rand(0.1, 0.2), rand(500, 900));
        else if (r < 0.55) this.flash('brow', rand(0.12, 0.22), 380);
        else if (r < 0.65) this.flash('asym', rand(-0.3, 0.3), 700);
        else if (r < 0.72) this.flash('squint', 0.15, 600);
      }
    }

    // Blend toward target + active pulses
    const add = {};
    this.pulses = this.pulses.filter((p) => now < p.end);
    for (const p of this.pulses) {
      const t = (now - p.start) / (p.end - p.start);
      add[p.key] = (add[p.key] || 0) + p.amount * Math.sin(Math.PI * t);
    }
    for (const key of KEYS) c[key] = lerp(c[key], this.target[key] + (add[key] || 0), key === 'gx' || key === 'gy' ? 0.08 : 0.12);

    // Mouth: audio level > word boundaries > syllable fallback
    let mouth = 0;
    let wide = 0;
    if (this.isSpeaking) {
      if (now - this.levelAt < 150) {
        mouth = clamp(this.level * 1.6, 0, 1);
        wide = Math.sin(now / 170) * 0.35;
      } else {
        const syll = 0.5 + 0.5 * Math.abs(Math.sin(now / 85)) * (0.6 + 0.4 * Math.sin(now / 230));
        const recent = this.lastViseme && now - this.lastViseme < 350;
        mouth = (recent ? this.mouthTarget : 0.55) * syll;
        wide = recent ? this.wideTarget : 0.2 * Math.sin(now / 300);
      }
    }
    // Breath in: a small parted-lips inhale
    let breath = 0;
    if (this.breathStart) {
      const p = (now - this.breathStart) / 650;
      if (p < 1) breath = Math.sin(p * Math.PI);
      else this.breathStart = 0;
    }
    c.mouth = lerp(c.mouth, Math.max(mouth, c.open, breath * 0.18), 0.4);
    c.wide = lerp(c.wide, wide, 0.25);

    // Blinks (more often while thinking, and after looking back)
    if (now > this.nextBlink) {
      this.blinkEnd = now + rand(110, 160);
      this.nextBlink = now + (this.mode === 'thinking' ? rand(900, 2200) : rand(2200, 5500));
      if (Math.random() < 0.15) this.nextBlink = now + 280; // double blink
    }
    const blinking = now < this.blinkEnd;
    c.blink = lerp(c.blink, blinking ? 0.05 : 1, blinking ? 0.65 : 0.3);

    // Where to look
    const listeningToUser = (this.mode === 'listening' || this.mode === 'idle') && this.user?.present;
    if (listeningToUser) {
      // Eye contact: follow the person's face in the camera
      this.gaze = { x: clamp(this.user.x * 0.7, -0.8, 0.8), y: clamp(this.user.y * 0.5, -0.5, 0.5) };
    } else if (now > this.nextGlance && this.mode !== 'thinking') {
      const away = Math.random() < (this.mode === 'speaking' ? 0.35 : 0.45);
      this.gaze = away ? { x: rand(-0.7, 0.7), y: rand(-0.35, 0.2) } : { x: 0, y: 0 };
      this.nextGlance = now + (away ? rand(500, 1100) : rand(2000, 4200));
      if (away) this.blinkEnd = Math.max(this.blinkEnd, now + 90); // people blink on gaze shifts
    }
    // Saccades: tiny eye jitters
    if (now > this.saccade.next) {
      this.saccade = { x: rand(-0.07, 0.07), y: rand(-0.05, 0.05), next: now + rand(250, 900) };
    }
    const gx = this.gaze.x + c.gx + this.saccade.x;
    const gy = this.gaze.y + c.gy + this.saccade.y;
    c.eyeX = lerp(c.eyeX, gx, 0.25);
    c.eyeY = lerp(c.eyeY, gy, 0.25);

    // Nod
    let nod = 0;
    if (this.nodStart) {
      const p = (now - this.nodStart) / 650;
      if (p < 1) nod = Math.sin(p * Math.PI * 2) * 6 * (1 - p) * (this.nodStrength || 1);
      else this.nodStart = 0;
    }

    // Head: idle sway, talking bob, laugh bounce, breathing
    c.headTilt = lerp(c.headTilt, c.tilt + this.tiltOffset, 0.05);
    const sway = Math.sin(now / 1900) * 1.6 + Math.sin(now / 3100) * 1.1;
    const talk = this.isSpeaking ? Math.sin(now / 160) * 0.7 + (now - this.levelAt < 150 ? this.level * 2 : 0) : 0;
    const laugh = now < this.laughUntil ? Math.abs(Math.sin(now / 105)) * 2.5 : 0;
    const breathing = Math.sin(now / 2400) * 1.4 - breath * 2.5;
    this.head.setAttribute(
      'transform',
      `rotate(${(c.headTilt + sway).toFixed(2)} 200 330) translate(${(c.eyeX * 3).toFixed(2)} ${(breathing + nod - laugh - talk * 0.4).toFixed(2)})`,
    );
    this.body.setAttribute('transform', `translate(0 ${(Math.sin(now / 2400) * 1.2 - breath * 2).toFixed(2)})`);

    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  draw() {
    const c = this.cur;
    // Eyes
    const open = clamp(c.blink * c.eye * (1 - c.squint * 0.55), 0.04, 1.35);
    const ry = 10 * open;
    for (const [side, cx] of [['L', -38], ['R', 38]]) {
      const clip = side === 'L' ? this.clipL : this.clipR;
      clip.setAttribute('ry', ry.toFixed(2));
      clip.setAttribute('cy', (c.squint * 2).toFixed(2));
      this[`iris${side}`].setAttribute('transform', `translate(${(c.eyeX * 5).toFixed(2)} ${(c.eyeY * 3.5).toFixed(2)})`);
      const top = -ry + c.squint * 2;
      this[`lid${side}`].setAttribute('d', `M${cx - 16} ${(c.squint * 2).toFixed(2)} Q${cx} ${(top * 1.9).toFixed(2)} ${cx + 16} ${(c.squint * 2).toFixed(2)}`);
    }

    // Brows: raise, inner-up concern, and left/right asymmetry
    const by = 172 - c.brow * 12;
    const inner = c.concern * 8;
    const aL = -c.asym * 6;
    const aR = c.asym * 4;
    this.browL.setAttribute('d', `M140 ${(by + 3 + aL).toFixed(1)} Q158 ${(by - 6 + aL).toFixed(1)} 180 ${(by - inner + aL * 0.5).toFixed(1)}`);
    this.browR.setAttribute('d', `M220 ${(by - inner + aR * 0.5).toFixed(1)} Q242 ${(by - 6 + aR).toFixed(1)} 260 ${(by + 3 + aR).toFixed(1)}`);

    // Mouth
    const w = 22 + c.wide * 7 + c.smile * 6;
    const corner = -c.smile * 7 + c.concern * 3;
    const openPx = c.mouth * 20;
    const upperMid = -1.5 - openPx * 0.25 + c.smile * 1.5;
    const lowerMid = 1.5 + openPx + c.smile * 7;
    const ctrl = (mid) => 2 * mid - corner;
    const skew = c.asym * 2; // slight lopsided smile when skeptical
    const d = `M${-w} ${corner - skew} Q0 ${ctrl(upperMid)} ${w} ${corner + skew} Q0 ${ctrl(lowerMid)} ${-w} ${corner - skew} Z`;
    this.mouth.setAttribute('d', d);
    this.lip.setAttribute('d', d);
    this.teeth.setAttribute('opacity', clamp((openPx - 3) / 6, 0, 0.9) * (c.smile > 0.2 || c.mouth > 0.3 ? 1 : 0));
    this.teeth.setAttribute('y', (upperMid - 0.5).toFixed(2));
    this.teeth.setAttribute('width', (w * 1.1).toFixed(1));
    this.teeth.setAttribute('x', (-w * 0.55).toFixed(1));

    const blush = clamp(0.15 + Math.max(0, c.smile) * 0.22 + c.blush * 0.5, 0, 0.75).toFixed(2);
    this.cheekL.setAttribute('opacity', blush);
    this.cheekR.setAttribute('opacity', blush);
  }
}
