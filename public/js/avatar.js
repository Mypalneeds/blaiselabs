// Original stylised SVG avatar with procedural expression, gaze, blinking,
// listening backchannels (nods) and speech-driven mouth movement.

const NS = 'http://www.w3.org/2000/svg';

const EXPRESSIONS = {
  neutral:   { smile: 0.15, brow: 0,    concern: 0,   eye: 1,    squint: 0,    tilt: 0,  open: 0 },
  happy:     { smile: 0.75, brow: 0.2,  concern: 0,   eye: 1,    squint: 0.2,  tilt: 2,  open: 0 },
  laugh:     { smile: 1,    brow: 0.35, concern: 0,   eye: 0.9,  squint: 0.45, tilt: 4,  open: 0.35 },
  curious:   { smile: 0.25, brow: 0.55, concern: 0,   eye: 1.05, squint: 0,    tilt: 7,  open: 0 },
  concerned: { smile: -0.3, brow: 0.1,  concern: 1,   eye: 1,    squint: 0.05, tilt: -3, open: 0 },
  surprised: { smile: 0.1,  brow: 1,    concern: 0,   eye: 1.25, squint: 0,    tilt: 0,  open: 0.3 },
  thinking:  { smile: 0,    brow: 0.25, concern: 0.3, eye: 0.95, squint: 0.1,  tilt: -5, open: 0 },
};

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
    this.cur = { ...EXPRESSIONS.neutral, mouth: 0, wide: 0, nod: 0, blink: 1, gx: 0, gy: 0 };
    this.mouthTarget = 0;
    this.wideTarget = 0;
    this.nodUntil = 0;
    this.nextBlink = performance.now() + 1500;
    this.blinkEnd = 0;
    this.gazeTarget = { x: 0, y: 0 };
    this.nextGlance = performance.now() + 3000;
    this.lastUserPulse = 0;
    this.lastNod = 0;
    this.emotionUntil = 0;
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
    if (mode === 'thinking') {
      this.gazeTarget = { x: -0.5, y: -0.6 };
      if (performance.now() > this.emotionUntil) this.target = { ...EXPRESSIONS.thinking };
    } else if (mode === 'listening') {
      this.gazeTarget = { x: 0, y: 0 };
    }
  }

  setEmotion(name, holdMs = 6000) {
    const e = EXPRESSIONS[name] || EXPRESSIONS.neutral;
    this.target = { ...e };
    this.emotionUntil = performance.now() + holdMs;
  }

  // Called as the user talks (interim transcripts): attentive face + occasional nod.
  userPulse(wordCount = 0) {
    const now = performance.now();
    if (this.mode !== 'speaking') {
      this.gazeTarget = { x: 0, y: 0 };
      if (now > this.emotionUntil) this.target = { ...EXPRESSIONS.neutral, smile: 0.3, brow: 0.15 };
      if (wordCount > 3 && now - this.lastNod > 2600 && Math.random() < 0.35) this.nod();
    }
    this.lastUserPulse = now;
  }

  nod(strength = 1) {
    this.lastNod = performance.now();
    this.nodStart = this.lastNod;
    this.nodStrength = strength;
  }

  // Called on each spoken word boundary (if the browser supports it).
  viseme(word = '') {
    const w = word.toLowerCase();
    const vowels = (w.match(/[aeiouy]/g) || []).length;
    const round = /[ouw]/.test(w);
    const closed = /^[mbp]/.test(w);
    this.mouthTarget = closed ? 0.15 : clamp(0.45 + vowels * 0.12, 0.3, 1);
    this.wideTarget = round ? -0.6 : /[ei]/.test(w) ? 0.6 : 0;
    this.lastViseme = performance.now();
  }

  speaking(on) {
    this.isSpeaking = on;
    if (on) this.gazeTarget = { x: 0, y: 0 };
    if (!on) {
      this.mouthTarget = 0;
      this.wideTarget = 0;
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  // ---- animation --------------------------------------------------------
  loop(now) {
    const c = this.cur;
    const t = this.target;
    const k = 0.12;

    if (now > this.emotionUntil && this.mode === 'idle') this.target = { ...EXPRESSIONS.neutral };

    for (const key of ['smile', 'brow', 'concern', 'eye', 'squint', 'tilt', 'open']) c[key] = lerp(c[key], t[key], k);

    // Speech mouth: word-boundary targets plus a syllable oscillation fallback
    let mouth = 0;
    let wide = 0;
    if (this.isSpeaking) {
      const syll = 0.5 + 0.5 * Math.abs(Math.sin(now / 85)) * (0.6 + 0.4 * Math.sin(now / 230));
      const recent = this.lastViseme && now - this.lastViseme < 350;
      const base = recent ? this.mouthTarget : 0.55;
      mouth = base * syll;
      wide = recent ? this.wideTarget : 0.2 * Math.sin(now / 300);
    }
    c.mouth = lerp(c.mouth, Math.max(mouth, t.open), 0.35);
    c.wide = lerp(c.wide, wide, 0.25);

    // Blink
    if (now > this.nextBlink) {
      this.blinkEnd = now + 130;
      this.nextBlink = now + 2200 + Math.random() * 4000;
      if (Math.random() < 0.15) this.nextBlink = now + 300; // double blink
    }
    const blinking = now < this.blinkEnd;
    c.blink = lerp(c.blink, blinking ? 0.05 : 1, blinking ? 0.6 : 0.3);

    // Gaze: occasional glances away while idle/speaking, steady while listening
    if (now > this.nextGlance && this.mode !== 'listening') {
      const away = Math.random() < 0.4;
      this.gazeTarget = away ? { x: (Math.random() - 0.5) * 1.4, y: (Math.random() - 0.5) * 0.6 } : { x: 0, y: 0 };
      this.nextGlance = now + (away ? 700 : 2500) + Math.random() * 2000;
    }
    c.gx = lerp(c.gx, this.gazeTarget.x, 0.15);
    c.gy = lerp(c.gy, this.gazeTarget.y, 0.15);

    // Nod
    let nod = 0;
    if (this.nodStart) {
      const p = (now - this.nodStart) / 700;
      if (p < 1) nod = Math.sin(p * Math.PI * 2) * 6 * (1 - p) * (this.nodStrength || 1);
      else this.nodStart = 0;
    }

    // Idle motion + breathing
    const sway = Math.sin(now / 1900) * 1.6 + Math.sin(now / 3100) * 1.1;
    const bob = Math.sin(now / 2400) * 1.5 + (this.isSpeaking ? Math.sin(now / 160) * 0.6 : 0);
    const laughBounce = t === EXPRESSIONS.laugh || t.squint > 0.4 ? Math.abs(Math.sin(now / 110)) * 1.5 : 0;
    this.head.setAttribute('transform', `rotate(${(c.tilt + sway).toFixed(2)} 200 330) translate(${(c.gx * 2).toFixed(2)} ${(bob + nod - laughBounce).toFixed(2)})`);
    this.body.setAttribute('transform', `translate(0 ${(Math.sin(now / 2400) * 1.2).toFixed(2)})`);

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
      this[`iris${side}`].setAttribute('transform', `translate(${(c.gx * 5).toFixed(2)} ${(c.gy * 3).toFixed(2)})`);
      const top = -ry + c.squint * 2;
      this[`lid${side}`].setAttribute('d', `M${cx - 16} ${(c.squint * 2).toFixed(2)} Q${cx} ${(top * 1.9).toFixed(2)} ${cx + 16} ${(c.squint * 2).toFixed(2)}`);
    }

    // Brows: raise with brow, inner ends lift with concern
    const by = 172 - c.brow * 12;
    const inner = c.concern * 8;
    this.browL.setAttribute('d', `M140 ${(by + 3).toFixed(1)} Q158 ${(by - 6).toFixed(1)} 180 ${(by - inner).toFixed(1)}`);
    this.browR.setAttribute('d', `M220 ${(by - inner).toFixed(1)} Q242 ${(by - 6).toFixed(1)} 260 ${(by + 3).toFixed(1)}`);

    // Mouth
    const w = 22 + c.wide * 7 + c.smile * 6;
    const corner = -c.smile * 7 + c.concern * 3;
    const openPx = c.mouth * 20;
    const upperMid = -1.5 - openPx * 0.25 + c.smile * 1.5;
    const lowerMid = 1.5 + openPx + c.smile * 7;
    const ctrl = (mid) => 2 * mid - corner;
    const d = `M${-w} ${corner} Q0 ${ctrl(upperMid)} ${w} ${corner} Q0 ${ctrl(lowerMid)} ${-w} ${corner} Z`;
    this.mouth.setAttribute('d', d);
    this.lip.setAttribute('d', d);
    this.teeth.setAttribute('opacity', clamp((openPx - 3) / 6, 0, 0.9) * (c.smile > 0.2 || c.mouth > 0.3 ? 1 : 0));
    this.teeth.setAttribute('y', (upperMid - 0.5).toFixed(2));
    this.teeth.setAttribute('width', (w * 1.1).toFixed(1));
    this.teeth.setAttribute('x', (-w * 0.55).toFixed(1));

    const blush = (0.15 + Math.max(0, c.smile) * 0.25).toFixed(2);
    this.cheekL.setAttribute('opacity', blush);
    this.cheekR.setAttribute('opacity', blush);
  }
}
