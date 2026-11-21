import { ADVISORS, FACES, SUPPORT } from './advisors.js';
import { callsEnabled, startCall, endCall, toggleMic, toggleCamera } from './call.js';

const $ = (sel) => document.querySelector(sel);

// ---------- preferences (this device only) ----------
const PREFS_KEY = 'blaiselabs.prefs';
function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}
function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}
const faceFor = (advisor) => readPrefs().faces?.[advisor.id] || advisor.face;

// ---------- notices ----------
let noticeTimer;
function notice(text, ms = 4500) {
  const el = $('#notice');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (el.hidden = true), ms);
}

// ---------- lobby ----------
let enabled = true;

function renderAdvisors() {
  const list = $('#advisors');
  list.innerHTML = '';
  for (const advisor of ADVISORS) {
    const li = document.createElement('li');
    li.className = 'advisor';
    const faceOptions = Object.entries(FACES)
      .map(([id, label]) => `<option value="${id}"${id === faceFor(advisor) ? ' selected' : ''}>${label}</option>`)
      .join('');
    li.innerHTML = `
      <div class="advisor-text">
        <h3 class="advisor-name">${advisor.name}</h3>
        <p class="advisor-focus">${advisor.focus}</p>
      </div>
      <div class="advisor-actions">
        <label class="face-picker">
          <span>Appears as</span>
          <select aria-label="${advisor.name}'s appearance">${faceOptions}</select>
        </label>
        <button type="button" class="primary call-button"${enabled ? '' : ' disabled'}>Call ${advisor.name}</button>
      </div>`;
    li.querySelector('select').addEventListener('change', (e) => {
      const faces = { ...(readPrefs().faces || {}), [advisor.id]: e.target.value };
      writePrefs({ faces });
    });
    li.querySelector('.call-button').addEventListener('click', () => requestCall(advisor));
    list.appendChild(li);
  }
}

function renderSupport() {
  $('#supportNumber').textContent = SUPPORT.display;
  $('#callNumber').href = `tel:${SUPPORT.tel}`;
  $('#whatsappNumber').href = `https://wa.me/${SUPPORT.whatsapp}`;
  $('#copyNumber').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT.display.replace(/\s/g, ''));
      notice('Number copied.', 2500);
    } catch {
      notice(`Copy failed. The number is ${SUPPORT.display}.`);
    }
  });
}

// ---------- consent (once per device) ----------
function requestCall(advisor) {
  if (readPrefs().consented) return beginCall(advisor);
  const dialog = $('#consent');
  dialog.returnValue = '';
  dialog.showModal();
  dialog.addEventListener(
    'close',
    () => {
      if (dialog.returnValue !== 'ok') return;
      writePrefs({ consented: true });
      beginCall(advisor);
    },
    { once: true },
  );
}

// ---------- call screen ----------
const STATUS_TEXT = {
  connecting: 'Connecting',
  waiting: 'Waiting for a free line',
  preparing: 'Joining',
  listening: 'Listening',
  thinking: 'Thinking it through',
  speaking: 'Speaking',
};
let timer = null;
let startedAt = 0;
let inCall = false;

function setStatus(state, advisor) {
  const el = $('#callStatus');
  el.dataset.state = state;
  el.textContent = STATUS_TEXT[state] || state;
  if (state === 'preparing') $('#waitingText').textContent = `${advisor.name} is joining the call.`;
  if (state === 'waiting') $('#waitingText').textContent = 'All lines are busy. You’re next in line.';
  if (['listening', 'speaking', 'thinking'].includes(state) && !startedAt) {
    startedAt = Date.now();
    $('#call').classList.add('live');
    timer = setInterval(tick, 1000);
  }
}

function tick() {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  $('#callTimer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showCall(advisor) {
  $('#lobby').hidden = true;
  $('#call').hidden = false;
  $('#call').classList.remove('live');
  $('#callName').textContent = advisor.name;
  $('#waitingName').textContent = advisor.name;
  $('#waitingText').textContent = 'Connecting. This can take up to 30 seconds.';
  $('#callTimer').textContent = '0:00';
  $('#selfWrap').hidden = true;
  setPressed($('#micBtn'), true, 'Mute microphone', 'Unmute microphone');
  setPressed($('#camBtn'), false, 'Turn camera off', 'Turn camera on');
  startedAt = 0;
}

function showLobby() {
  clearInterval(timer);
  timer = null;
  $('#call').hidden = true;
  $('#lobby').hidden = false;
  inCall = false;
}

function setPressed(button, on, labelOn, labelOff) {
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', on ? labelOn : labelOff);
}

async function beginCall(advisor) {
  if (inCall) return;
  inCall = true;
  showCall(advisor);
  setStatus('connecting', advisor);
  try {
    await startCall({
      advisor,
      face: faceFor(advisor),
      video: $('#advisorVideo'),
      audio: $('#advisorAudio'),
      selfView: $('#selfView'),
      on: {
        status: (state) => setStatus(state, advisor),
        notice,
        ended: (reason) => {
          const why = {
            'time-limit': 'The call reached its time limit.',
            'policy-violation': 'The call was ended for breaking the usage policy.',
            'age-check': 'Calls are for adults only.',
            'connection-lost': 'The connection was lost.',
            refused: 'The call couldn’t start.',
          }[reason];
          if (why) notice(why, 6000);
          hangUp();
        },
      },
    });
  } catch (err) {
    notice(err.message, 7000);
    showLobby();
  }
}

async function hangUp() {
  if (!inCall) return;
  await endCall();
  showLobby();
}

$('#endBtn').addEventListener('click', hangUp);
$('#micBtn').addEventListener('click', async () => {
  const on = await toggleMic();
  setPressed($('#micBtn'), on, 'Mute microphone', 'Unmute microphone');
  if (!on) notice('You’re muted.', 2500);
});
$('#camBtn').addEventListener('click', async () => {
  try {
    const on = await toggleCamera();
    setPressed($('#camBtn'), on, 'Turn camera off', 'Turn camera on');
    $('#selfWrap').hidden = !on;
  } catch {
    notice('Camera unavailable. Check your browser’s camera permission.');
  }
});
window.addEventListener('pagehide', () => endCall());

// ---------- start ----------
renderSupport();
renderAdvisors();
callsEnabled().then((ok) => {
  enabled = ok;
  if (!ok) {
    $('#setupNote').hidden = false;
    $('#setupNote').textContent = 'Calls aren’t available right now. If you run this site, add NUANCE_API_KEY in Netlify’s environment variables and redeploy.';
    renderAdvisors();
  }
});
