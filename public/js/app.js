import { Avatar, SKIN_TONES, EMOTIONS } from './avatar.js';
import { PERSONAS } from './personas.js';
import { Listener, Speaker, support, kokoro } from './voice.js';
import { FaceReader } from './vision.js';
import { startHD, endHD, hd, hdEnabled, HD_FACES } from './hd.js';

const $ = (s) => document.querySelector(s);
const SKIN_RE = /\[skin:\s*([a-z]+)\]/i;
const EMOTION_RE = new RegExp(`\\[(${EMOTIONS.join('|')})\\]`, 'i');
const END_OF_TURN_MS = 850;

// ---------- settings ----------
const SETTINGS_KEY = 'joy.settings';
const defaults = { key: '', model: '', lang: 'en-US', voice: '', interrupt: true, captions: true, skins: {}, engine: 'auto', seeMe: true, memory: true, kokoroUsed: false, hd: false, hdFaces: { joy: 'mira', osas: 'sonia', greg: 'sam' } };
function loadSettings() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}
let settings = loadSettings();

// ---------- state ----------
let persona = PERSONAS.joy;
let avatar = null;
let listener = null;
const speaker = new Speaker();
let messages = [];
let state = 'idle';
let pending = '';
let turnTimer = null;
let controller = null;
let camStream = null;
let micOn = true;
let replyText = '';
let elevenEnabled = false;
let hdAvailable = false;
let hdMode = false;
const reader = new FaceReader();
let userTurnStarted = false;

// ---------- memory (stays on this device) ----------
const MEM_PREFIX = 'joy.memory.';
function loadMemory(id) {
  if (!settings.memory) return null;
  try {
    return JSON.parse(localStorage.getItem(MEM_PREFIX + id) || 'null');
  } catch {
    return null;
  }
}
function saveMemory() {
  if (!settings.memory || !persona) return;
  const keep = messages.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-24);
  if (!keep.some((m) => m.role === 'user')) return;
  try {
    localStorage.setItem(MEM_PREFIX + persona.id, JSON.stringify({ messages: keep, lastSeen: Date.now() }));
  } catch {}
}
function forgetAll() {
  for (const id of Object.keys(PERSONAS)) localStorage.removeItem(MEM_PREFIX + id);
}
let memoryAtStart = null;
function context() {
  const d = new Date();
  const ctx = { hour: d.getHours(), day: d.getDay() };
  if (memoryAtStart) {
    ctx.returning = true;
    ctx.daysSince = Math.max(0, (Date.now() - memoryAtStart.lastSeen) / 864e5);
  }
  return ctx;
}

// ---------- voices ----------
function wantedEngine() {
  const english = settings.lang.startsWith('en');
  const e = settings.engine;
  if (e === 'eleven') return elevenEnabled ? 'eleven' : 'browser';
  if (e === 'kokoro') return english && support.audio ? 'kokoro' : 'browser';
  if (e === 'browser') return 'browser';
  // auto: studio voice if the site owner set it up, else the natural voice if downloaded before
  if (elevenEnabled) return 'eleven';
  if (settings.kokoroUsed && english && support.audio) return 'kokoro';
  return 'browser';
}
async function applyEngine() {
  const want = wantedEngine();
  if (want === 'kokoro' && kokoro.state !== 'ready') {
    speaker.setEngine('browser', persona); // talk with the device voice while downloading
    try {
      await kokoro.load();
      settings.kokoroUsed = true;
      saveSettings(settings);
      if (wantedEngine() !== 'kokoro') return;
      toast('Natural voice ready ✨', 2500);
    } catch (err) {
      toast(`Natural voice couldn't load on this device (${err.message}). Using the device voice.`, 6000);
      return;
    }
  }
  speaker.setEngine(want, persona);
  speaker.prepare(FILLER_LIST);
}
kokoro.addEventListener('progress', (e) => toast(`Downloading natural voice… ${Math.round(e.detail * 100)}% (one time only)`, 4000));
fetch('/api/tts').then((r) => r.ok && r.json()).then((j) => (elevenEnabled = !!j?.enabled)).catch(() => {});

// ---------- fillers: an instant human reaction while the AI thinks ----------
const FILLERS = {
  question: ['Hmm.', 'Hmm, okay.', 'Well,'],
  sad: ['Aww.', 'Oh no.'],
  happy: ['Oh!', 'Ooh.', 'Oh wow.'],
  funny: ['Ha!'],
  other: ['Mm.', 'Right.', 'Okay.'],
};
const FILLER_LIST = Object.values(FILLERS).flat();
const FILLER_FACE = { question: 'thinking', sad: 'empathetic', happy: 'excited', funny: 'laugh', other: 'neutral' };
function pickFiller(text) {
  const t = text.toLowerCase();
  let kind = 'other';
  if (/\b(haha|lol|lmao|funny|joke)\b|😂/.test(t)) kind = 'funny';
  else if (/\b(sad|tired|stress|stressed|sick|lost|died|passed|bad day|worried|angry|broke|hurt|lonely|scared|anxious|failed)\b/.test(t)) kind = 'sad';
  else if (/\b(great|amazing|won|win|got the|happy|excited|love|yay|finally|promoted|passed my|engaged|married|birthday)\b/.test(t)) kind = 'happy';
  else if (/\?\s*$/.test(t) || /^(what|how|why|who|when|where|which|can|could|should|would|do|does|is|are|tell me|explain)\b/.test(t)) kind = 'question';
  const chance = kind === 'other' ? 0.3 : 0.65;
  if (text.split(/\s+/).length < 3 || Math.random() > chance) return null;
  const list = FILLERS[kind];
  const filler = list[Math.floor(Math.random() * list.length)];
  return speaker.isReady(filler) ? { filler, face: FILLER_FACE[kind] } : null;
}

// ---------- skin tones ----------
const skinOf = (p) => settings.skins?.[p.id] || p.skin;
function setSkin(name, { announce = false } = {}) {
  if (!SKIN_TONES[name]) return;
  settings.skins = { ...(settings.skins || {}), [persona.id]: name };
  saveSettings(settings);
  avatar?.setSkin(name);
  thumbs.forEach((a) => a.personaId === persona.id && a.setSkin(name));
  document.querySelectorAll('.swatches').forEach(renderSwatches);
  if (announce) toast(`${persona.name}'s skin tone: ${SKIN_TONES[name].label}`, 2500);
}
function renderSwatches(wrap) {
  wrap.innerHTML = '';
  const current = skinOf(persona);
  for (const [id, t] of Object.entries(SKIN_TONES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (id === current ? ' on' : '');
    b.style.background = `radial-gradient(circle at 40% 35%, ${t.skin[0]}, ${t.skin[1]})`;
    b.setAttribute('aria-label', `${t.label} skin tone`);
    b.setAttribute('aria-pressed', String(id === current));
    b.title = t.label;
    b.addEventListener('click', () => setSkin(id));
    wrap.appendChild(b);
  }
}

// ---------- UI helpers ----------
function setState(s) {
  state = s;
  const labels = { idle: 'Ready', listening: micOn ? 'Listening…' : 'Mic off', thinking: 'Thinking…', speaking: 'Speaking' };
  $('#status').textContent = labels[s] || s;
  $('#status').dataset.state = s;
  avatar?.setMode(s);
}

function caption(who, text) {
  if (!settings.captions) return;
  const el = who === 'you' ? $('#capYou') : $('#capAi');
  el.textContent = text;
  el.hidden = !text;
}

function toast(msg, ms = 4000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

const clean = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/[*_#`>~]/g, '').replace(/\s+/g, ' ');

// Words of a transcript that also appear in what the avatar is saying → likely mic echo.
function isEcho(text) {
  const spoken = new Set(clean(speaker.spokenText + ' ' + replyText).toLowerCase().match(/[\p{L}']+/gu) || []);
  const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
  if (!words.length) return true;
  const hit = words.filter((w) => spoken.has(w)).length;
  return hit / words.length >= 0.6;
}

// ---------- conversation ----------
function onInterim(text) {
  if (!micOn) return;
  const words = text.split(/\s+/).length;
  if (state === 'speaking' || (state === 'thinking' && controller)) {
    if (!settings.interrupt || isEcho(text) || words < 2) return;
    interrupt();
  }
  if (!userTurnStarted) {
    userTurnStarted = true;
    reader.beginTurn();
  }
  avatar.userPulse(words);
  caption('you', (pending + ' ' + text).trim());
  armTurnTimer();
}

function onFinal(text) {
  if (!micOn) return;
  if ((state === 'speaking' || state === 'thinking') && isEcho(text)) return;
  if (state === 'speaking') interrupt();
  pending = (pending + ' ' + text).trim();
  caption('you', pending);
  avatar.userPulse(text.split(/\s+/).length);
  armTurnTimer();
}

function armTurnTimer() {
  clearTimeout(turnTimer);
  turnTimer = setTimeout(commitTurn, END_OF_TURN_MS);
}

function commitTurn() {
  const text = pending.trim();
  if (!text) return;
  pending = '';
  // If the user kept talking while we were thinking, merge into one turn.
  if (state === 'thinking' && controller) {
    controller.abort();
    const last = messages[messages.length - 1];
    if (last?.role === 'user') {
      messages.pop();
      return send(last.content + ' ' + text);
    }
  }
  send(text);
}

function interrupt() {
  controller?.abort();
  controller = null;
  speaker.cancel();
  if (replyText.trim()) messages.push({ role: 'assistant', content: replyText.trim() + ' —' });
  replyText = '';
  avatar.speaking(false);
  avatar.setEmotion('curious', 2000);
  setState('listening');
}

async function send(text) {
  messages.push({ role: 'user', content: text });
  caption('you', text);
  const cue = reader.summary();
  userTurnStarted = false;
  setState('thinking');
  avatar.nod(0.6);
  speaker.cancel();
  speaker.resetTranscript();
  replyText = '';
  const f = pickFiller(text);
  if (f) {
    avatar.setEmotion(f.face, 1500);
    speak(f.filler);
  }

  controller = new AbortController();
  const myController = controller;
  const headers = { 'Content-Type': 'application/json' };
  if (settings.key) headers['x-user-key'] = settings.key;
  if (settings.key && settings.model) headers['x-user-model'] = settings.model;

  let buf = '';
  let emotionDone = false;
  let skinApplied = false;
  const flush = (force) => {
    if (!emotionDone) {
      const m = buf.match(/^\s*\[(\w+)\]\s*/);
      if (m) {
        avatar.setEmotion(m[1].toLowerCase());
        buf = buf.slice(m[0].length);
        emotionDone = true;
      } else if (buf.trimStart().startsWith('[') && !buf.includes(']') && !force) return;
      else emotionDone = true;
    }
    // Speak complete sentences as soon as they arrive → lower latency.
    const re = /^(.+?[.!?…]+["')\]]*)(\s+|$)/s;
    let m;
    while ((m = buf.match(re)) && (m[2] || force)) {
      const sentence = clean(m[1]).trim();
      buf = buf.slice(m[0].length);
      const em = m[1].match(EMOTION_RE);
      if (em) avatar.setEmotion(em[1].toLowerCase());
      if (sentence) speak(sentence);
    }
    if (force && clean(buf).trim()) {
      speak(clean(buf).trim());
      buf = '';
    }
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ persona: persona.id, messages, context: context(), cue, filler: f?.filler }),
      signal: myController.signal,
    });
    if (!res.ok) {
      let e = {};
      try {
        e = await res.json();
      } catch {}
      throw Object.assign(new Error(e.error || `HTTP ${res.status}`), { code: e.error, detail: e.detail, status: res.status });
    }
    const stream = res.body.getReader();
    const dec = new TextDecoder();
    let first = true;
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (first && chunk.trim()) {
        first = false;
        avatar.breathe();
      }
      replyText += chunk;
      buf += chunk;
      if (!skinApplied) {
        const sk = replyText.match(SKIN_RE);
        if (sk && SKIN_TONES[sk[1].toLowerCase()]) {
          setSkin(sk[1].toLowerCase(), { announce: true });
          skinApplied = true;
        }
      }
      buf = buf.replace(SKIN_RE, '');
      flush(false);
    }
    flush(true);
    if (controller === myController) controller = null;
    if (replyText.trim()) messages.push({ role: 'assistant', content: ((f ? f.filler + ' ' : '') + replyText).trim() });
    replyText = '';
    saveMemory();
    if (!speaker.speaking) setState('listening');
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (controller === myController) controller = null;
    messages.pop();
    setState('listening');
    avatar.setEmotion('concerned', 3000);
    if (err.code === 'NO_KEY') {
      toast('No LLM key set on the server. Add a free key in Settings (or set LLM_API_KEY on Netlify).', 7000);
      openSettings();
    } else if (err.status === 404) {
      toast('API not found. Run with "netlify dev" locally, or deploy to Netlify.', 7000);
    } else {
      toast(`Couldn't get a reply (${err.code || err.message}). ${err.detail ? String(err.detail).slice(0, 120) : ''}`, 7000);
    }
  }
}

function speak(sentence) {
  speaker.enqueue(sentence);
}

speaker.addEventListener('sentence', (e) => {
  setState('speaking');
  avatar.speaking(true);
  avatar.sentenceStart(e.detail);
  caption('ai', e.detail);
});
speaker.addEventListener('word', (e) => avatar.viseme(e.detail));
speaker.addEventListener('level', (e) => avatar?.audioLevel(e.detail));
reader.addEventListener('update', (e) => avatar?.watchUser(e.detail));
speaker.addEventListener('idle', () => {
  avatar.speaking(false);
  if (!controller) setState('listening');
});

// ---------- call lifecycle ----------
async function startCall() {
  speaker.unlock();
  $('#lobby').hidden = true;
  $('#call').hidden = false;
  $('#personaName').textContent = persona.name;

  avatar?.destroy();
  avatar = new Avatar($('#stage'), persona.look);
  avatar.svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  avatar.setSkin(skinOf(persona));
  speaker.pickVoice(persona.voice, settings.lang, settings.voice);
  applyEngine();
  memoryAtStart = loadMemory(persona.id);
  messages = memoryAtStart?.messages ? [...memoryAtStart.messages] : [];
  pending = '';
  userTurnStarted = false;

  if (support.stt) {
    listener?.stop();
    listener = new Listener(settings.lang);
    listener.addEventListener('interim', (e) => onInterim(e.detail));
    listener.addEventListener('final', (e) => onFinal(e.detail));
    listener.addEventListener('error', (e) => {
      if (e.detail === 'not-allowed' || e.detail === 'service-not-allowed') {
        toast('Microphone blocked. Allow mic access, or type below.', 6000);
        showTyping(true);
      } else if (e.detail === 'network') {
        toast('Speech recognition needs an internet connection.', 5000);
      }
    });
    micOn = true;
    listener.start();
  } else {
    micOn = false;
    toast('Voice input isn\'t supported in this browser (try Chrome, Edge or Safari). You can type instead.', 7000);
    showTyping(true);
  }
  updateButtons();

  // Opening line
  setState('speaking');
  const g = memoryAtStart ? persona.welcomeBack : persona.greeting;
  const em = g.match(EMOTION_RE);
  if (em) avatar.setEmotion(em[1].toLowerCase());
  const line = clean(g).trim();
  messages.push({ role: 'assistant', content: g });
  speaker.resetTranscript();
  setTimeout(() => speak(line), 500);
}

// ---------- HD (Nuance) calls ----------
async function startHdCall() {
  hdMode = true;
  $('#lobby').hidden = true;
  $('#call').hidden = false;
  $('#call').classList.add('hd');
  $('#personaName').textContent = persona.name;
  $('#hdTag').hidden = false;
  caption('you', '');
  caption('ai', '');
  micOn = true;
  updateButtons();
  const ui = {
    status: (text, st) => {
      state = st;
      $('#status').textContent = text;
      $('#status').dataset.state = st;
    },
    caption,
    toast,
    ended: (reason) => {
      if (!hdMode) return;
      const why = { 'time-limit': 'The HD call reached its time limit.', 'policy-violation': 'The call was ended for breaking the usage policy.', 'age-check': 'HD calls are for adults only.', 'connection-lost': 'The connection was lost.', refused: 'HD couldn’t start this call.' }[reason];
      if (why) toast(why, 5000);
      leaveHd();
    },
  };
  try {
    await startHD(persona, settings.hdFaces?.[persona.id] || 'sam', ui);
    toast(`Tip: tap the camera so ${persona.name} can see you.`, 4000);
  } catch (err) {
    if (!hdMode) return;
    hdMode = false;
    $('#call').classList.remove('hd');
    $('#hdTag').hidden = true;
    if (err.fallback) {
      toast(`${err.message} Switching to standard mode.`, 6000);
      startCall();
    } else {
      toast(err.message, 6000);
      $('#call').hidden = true;
      $('#lobby').hidden = false;
      refreshLobby();
    }
  }
}

async function leaveHd() {
  hdMode = false;
  await endHD();
  $('#call').classList.remove('hd');
  $('#hdTag').hidden = true;
  $('#selfWrap').hidden = true;
  caption('you', '');
  caption('ai', '');
  $('#call').hidden = true;
  $('#lobby').hidden = false;
  state = 'idle';
  refreshLobby();
}

function endCall() {
  saveMemory();
  controller?.abort();
  controller = null;
  listener?.stop();
  speaker.cancel();
  stopCam();
  avatar?.destroy();
  avatar = null;
  clearTimeout(turnTimer);
  caption('you', '');
  caption('ai', '');
  $('#call').hidden = true;
  $('#lobby').hidden = false;
  state = 'idle';
}

async function toggleCam() {
  if (camStream) return stopCam();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    $('#selfView').srcObject = camStream;
    $('#selfWrap').hidden = false;
    if (settings.seeMe) startSeeing();
  } catch {
    toast('Camera unavailable or blocked.');
  }
  updateButtons();
}

async function startSeeing() {
  $('#seeBadge').hidden = false;
  $('#seeBadge').textContent = 'Starting face reading…';
  try {
    await reader.start($('#selfView'));
    $('#seeBadge').textContent = `👀 ${persona.name} can see you`;
  } catch (err) {
    $('#seeBadge').hidden = true;
    toast(`Face reading unavailable on this device (${err.message || err}).`, 5000);
  }
}

function stopCam() {
  reader.stop();
  $('#seeBadge').hidden = true;
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  $('#selfWrap').hidden = true;
  updateButtons();
}

function toggleMic() {
  if (!listener) return;
  micOn = !micOn;
  micOn ? listener.start() : listener.stop();
  if (!micOn) {
    pending = '';
    caption('you', '');
  }
  setState(state);
  updateButtons();
}

function showTyping(on) {
  $('#typeForm').hidden = !on;
  if (on) $('#typeInput').focus();
  updateButtons();
}

function updateButtons() {
  $('#btnMic').setAttribute('aria-pressed', String(micOn));
  $('#btnMic').classList.toggle('off', !micOn);
  $('#btnCam').setAttribute('aria-pressed', String(!!camStream));
  $('#btnCam').classList.toggle('off', !camStream);
  $('#btnCc').setAttribute('aria-pressed', String(settings.captions));
  $('#btnCc').classList.toggle('off', !settings.captions);
  $('#btnType').setAttribute('aria-pressed', String(!$('#typeForm').hidden));
}

// ---------- settings modal ----------
function openSettings() {
  $('#setKey').value = settings.key;
  $('#setModel').value = settings.model;
  $('#setLang').value = settings.lang;
  $('#setInterrupt').checked = settings.interrupt;
  $('#setEngine').value = settings.engine;
  $('#setSeeMe').checked = settings.seeMe;
  $('#setMemory').checked = settings.memory;
  $('#elevenNote').hidden = elevenEnabled;
  fillVoices();
  renderSwatches($('#settingsSwatches'));
  $('#settingsSkinLabel').textContent = `${persona.name}'s skin tone`;
  $('#settings').showModal();
}

function fillVoices() {
  const sel = $('#setVoice');
  const voices = speaker.voices;
  sel.innerHTML = '<option value="">Auto (best match)</option>' +
    voices.map((v) => `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name} — ${v.lang}</option>`).join('');
  sel.value = settings.voice;
}

$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const langChanged = settings.lang !== $('#setLang').value;
  settings = {
    ...settings,
    key: $('#setKey').value.trim(),
    model: $('#setModel').value.trim(),
    lang: $('#setLang').value,
    voice: $('#setVoice').value,
    interrupt: $('#setInterrupt').checked,
    engine: $('#setEngine').value,
    seeMe: $('#setSeeMe').checked,
    memory: $('#setMemory').checked,
  };
  saveSettings(settings);
  if (avatar) applyEngine();
  else if (wantedEngine() === 'kokoro' || settings.engine === 'kokoro') kokoro.load().catch(() => {});
  if (camStream && settings.seeMe && !reader.running) startSeeing();
  if (!settings.seeMe && reader.running) {
    reader.stop();
    $('#seeBadge').hidden = true;
  }
  speaker.pickVoice(persona.voice, settings.lang, settings.voice);
  if (langChanged) listener?.setLang(settings.lang);
  $('#settings').close();
  toast('Settings saved');
});
$('#settingsCancel').addEventListener('click', () => $('#settings').close());
$('#clearKey').addEventListener('click', () => ($('#setKey').value = ''));
$('#forgetBtn').addEventListener('click', () => {
  forgetAll();
  if (avatar) messages = messages.slice(-2);
  memoryAtStart = null;
  toast('Conversation memory cleared on this device.', 3000);
});

// ---------- wiring ----------
const thumbs = [];
function refreshLobby() {
  thumbs.splice(0).forEach((a) => a.destroy());
  const wrap = $('#personas');
  wrap.innerHTML = '';
  for (const p of Object.values(PERSONAS)) {
    const card = document.createElement('button');
    card.className = 'persona-card' + (p.id === persona.id ? ' selected' : '');
    card.type = 'button';
    card.setAttribute('aria-pressed', String(p.id === persona.id));
    card.innerHTML = `<div class="thumb"></div><div class="meta"><strong>${p.name}</strong><span>${p.tagline}</span></div>`;
    wrap.classList.toggle('single', Object.keys(PERSONAS).length === 1);
    card.addEventListener('click', () => {
      persona = p;
      refreshLobby();
    });
    wrap.appendChild(card);
    const a = new Avatar(card.querySelector('.thumb'), p.look);
    a.personaId = p.id;
    a.setSkin(skinOf(p));
    a.setEmotion('happy', 1e9);
    thumbs.push(a);
  }
  $('#startBtn').textContent = settings.hd && hdAvailable ? `Talk to ${persona.name} in HD ✨` : `Talk to ${persona.name}`;
  $('#hdRow').hidden = !hdAvailable;
  $('#hdToggle').checked = !!settings.hd;
  $('#skinSection').hidden = !!(settings.hd && hdAvailable);
  const faces = $('#hdFaces');
  faces.hidden = !(settings.hd && hdAvailable);
  faces.innerHTML = `<span class="field-label">${persona.name}'s HD look:</span>`;
  for (const [id, label] of Object.entries(HD_FACES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + ((settings.hdFaces?.[persona.id] || 'sam') === id ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      settings.hdFaces = { ...(settings.hdFaces || {}), [persona.id]: id };
      saveSettings(settings);
      refreshLobby();
    });
    faces.appendChild(b);
  }
  $('#skinLabel').textContent = `${persona.name}'s skin tone`;
  renderSwatches($('#lobbySwatches'));
}

$('#startBtn').addEventListener('click', () => {
  thumbs.splice(0).forEach((a) => a.destroy());
  settings.hd && hdAvailable ? startHdCall() : startCall();
});
$('#btnEnd').addEventListener('click', () => {
  if (hdMode) return leaveHd();
  endCall();
  refreshLobby();
});
$('#btnMic').addEventListener('click', async () => {
  if (!hdMode) return toggleMic();
  micOn = await hd.toggleMic();
  $('#status').textContent = micOn ? 'Listening…' : 'Mic off';
  updateButtons();
});
$('#btnCam').addEventListener('click', async () => {
  if (!hdMode) return toggleCam();
  const on = await hd.toggleCam().catch(() => false);
  $('#selfWrap').hidden = !on;
  $('#btnCam').classList.toggle('off', !on);
});
$('#btnCc').addEventListener('click', () => {
  settings.captions = !settings.captions;
  saveSettings(settings);
  if (!settings.captions) {
    $('#capYou').hidden = true;
    $('#capAi').hidden = true;
  }
  updateButtons();
});
$('#btnType').addEventListener('click', () => showTyping($('#typeForm').hidden));
$('#btnSettings').addEventListener('click', openSettings);
$('#lobbySettings').addEventListener('click', openSettings);
$('#typeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#typeInput').value.trim();
  if (!v) return;
  $('#typeInput').value = '';
  if (state === 'speaking' || state === 'thinking') interrupt();
  send(v);
});
speaker.addEventListener('voices', () => {
  if ($('#settings').open) fillVoices();
  if (avatar) speaker.pickVoice(persona.voice, settings.lang, settings.voice);
});

$('#hdToggle').addEventListener('change', (e) => {
  settings.hd = e.target.checked;
  saveSettings(settings);
  refreshLobby();
});
hdEnabled().then((on) => {
  hdAvailable = on;
  refreshLobby();
});

refreshLobby();
