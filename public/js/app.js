import { Avatar, SKIN_TONES } from './avatar.js';
import { PERSONAS } from './personas.js';
import { Listener, Speaker, support } from './voice.js';

const $ = (s) => document.querySelector(s);
const SKIN_RE = /\[skin:\s*([a-z]+)\]/i;
const EMOTION_RE = /\[(neutral|happy|laugh|curious|concerned|surprised|thinking)\]/i;
const END_OF_TURN_MS = 850;

// ---------- settings ----------
const SETTINGS_KEY = 'joy.settings';
const defaults = { key: '', model: '', lang: 'en-US', voice: '', interrupt: true, captions: true, skins: {} };
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
  setState('thinking');
  avatar.nod(0.6);
  speaker.cancel();
  speaker.resetTranscript();
  replyText = '';

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
      body: JSON.stringify({ persona: persona.id, messages }),
      signal: myController.signal,
    });
    if (!res.ok) {
      let e = {};
      try {
        e = await res.json();
      } catch {}
      throw Object.assign(new Error(e.error || `HTTP ${res.status}`), { code: e.error, detail: e.detail, status: res.status });
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
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
    if (replyText.trim()) messages.push({ role: 'assistant', content: replyText.trim() });
    replyText = '';
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
  caption('ai', e.detail);
});
speaker.addEventListener('word', (e) => avatar.viseme(e.detail));
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
  messages = [];
  pending = '';

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
  const g = persona.greeting;
  const em = g.match(EMOTION_RE);
  if (em) avatar.setEmotion(em[1].toLowerCase());
  const line = clean(g).trim();
  messages.push({ role: 'assistant', content: g });
  speaker.resetTranscript();
  setTimeout(() => speak(line), 500);
}

function endCall() {
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
  } catch {
    toast('Camera unavailable or blocked.');
  }
  updateButtons();
}

function stopCam() {
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
  };
  saveSettings(settings);
  speaker.pickVoice(persona.voice, settings.lang, settings.voice);
  if (langChanged) listener?.setLang(settings.lang);
  $('#settings').close();
  toast('Settings saved');
});
$('#settingsCancel').addEventListener('click', () => $('#settings').close());
$('#clearKey').addEventListener('click', () => ($('#setKey').value = ''));

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
  $('#startBtn').textContent = `Talk to ${persona.name}`;
  $('#skinLabel').textContent = `${persona.name}'s skin tone`;
  renderSwatches($('#lobbySwatches'));
}

$('#startBtn').addEventListener('click', () => {
  thumbs.splice(0).forEach((a) => a.destroy());
  startCall();
});
$('#btnEnd').addEventListener('click', () => {
  endCall();
  refreshLobby();
});
$('#btnMic').addEventListener('click', toggleMic);
$('#btnCam').addEventListener('click', toggleCam);
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

refreshLobby();
