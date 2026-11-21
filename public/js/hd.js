// HD mode: a live video call with a Nuance Labs persona (their real-time audio-visual model),
// carrying our agent's name, intro and Analaize knowledge. Uses Nuance credits.

const $ = (s) => document.querySelector(s);
let sdk = null;
let convo = null;
let outText = '';
let youText = '';

function deviceId() {
  try {
    let id = localStorage.getItem('joy.device');
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('joy.device', id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

export async function hdEnabled() {
  try {
    const r = await fetch('/api/nuance-token');
    return r.ok && !!(await r.json()).enabled;
  } catch {
    return false;
  }
}

export const HD_FACES = { sam: 'Sam', sonia: 'Sonia', mira: 'Mira' };

/**
 * Start an HD call. ui = { status(text, state), caption(who, text), toast(msg), ended(reason) }
 * Resolves when connected; rejects with { code, message, fallback } on failure.
 */
export async function startHD(agent, face, ui, { camera = false } = {}) {
  sdk ??= await import('../vendor/nuance-sdk.js');
  const video = $('#hdVideo');
  const audio = $('#hdAudio');
  outText = '';
  youText = '';

  convo = sdk.createNuanceConversation({
    token: async () => {
      const res = await fetch('/api/nuance-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agent.id, face, deviceId: deviceId() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.token) throw Object.assign(new Error(j.detail || j.error || `token ${res.status}`), { code: j.error });
      return j.token;
    },
    maxSessionSeconds: 600,
    mediaDevices: { cameraEnabled: camera, cameraFacing: 'user' },
    videoCapture: { width: 640, height: 480 },
  });

  convo.onChange((e) => {
    switch (e.type) {
      case 'state-changed':
        if (e.state === 'connecting') ui.status('Connecting…', 'thinking');
        else if (e.state === 'queued') ui.status('Waiting for a free slot…', 'thinking');
        else if (e.state === 'connected') ui.status('Connected', 'listening');
        else if (e.state === 'failed') ui.status('Connection failed', 'idle');
        break;
      case 'avatar-preparing':
        ui.status(`${agent.name} is getting ready…`, 'thinking');
        break;
      case 'tracks-changed':
        convo.avatar.videoTrack?.attach(video);
        convo.avatar.audioTrack?.attach(audio);
        if (convo.user.videoTrack) convo.user.videoTrack.attach($('#selfView'));
        break;
      case 'avatar-presented':
        ui.status('Listening…', 'listening');
        convo
          .sendInterfaceEvent({
            type: 'response.create',
            response: {
              instructions: `Greet the person now with: "Hi! My name is ${agent.name}. I was built by Micheal Blaise, the founder of Analaize Limited. What would you like to talk about?"`,
            },
          })
          .catch(() => {});
        break;
      case 'camera-changed':
        if (convo.user.videoTrack) convo.user.videoTrack.attach($('#selfView'));
        break;
      case 'network-changed':
        if (e.quality === 'poor' || e.network === 'poor') ui.toast('Weak connection: video may stutter.');
        break;
      case 'time-remaining':
        if (typeof e.seconds === 'number' && e.seconds <= 30) ui.toast(`About ${Math.round(e.seconds)}s left in this HD call.`);
        break;
      case 'session-ended':
        ui.ended(e.reason);
        break;
    }
  });

  convo.onInterfaceEvent((ev) => {
    switch (ev.type) {
      case 'session.input_transcript.delta':
        ui.status('Listening…', 'listening');
        youText += ev.delta;
        ui.caption('you', youText.trim());
        break;
      case 'session.input_transcript.done':
        youText = '';
        ui.caption('you', ev.transcript || '');
        break;
      case 'session.output_transcript.delta':
        ui.status('Speaking', 'speaking');
        outText += ev.delta;
        ui.caption('ai', outText.split(/(?<=[.!?])\s+/).slice(-2).join(' '));
        break;
      case 'session.output_audio.done':
        outText = '';
        ui.status('Listening…', 'listening');
        break;
      case 'error':
        if (ev.error?.message) ui.toast(ev.error.message);
        break;
    }
  });

  try {
    await convo.connect();
  } catch (err) {
    const code = err.code || err.constructor?.name;
    const retry = err.retryAfterSeconds;
    convo = null;
    let message = err.message || String(err);
    let fallback = true;
    if (/credits_spent/.test(message + code)) message = 'HD credits for today are used up.';
    else if (/capacity|busy|429|503/.test(message + code + (err.status || ''))) message = `HD is busy right now${retry ? ` (try again in ~${retry}s)` : ''}.`;
    else if (err instanceof sdk.ActiveSessionError) message = 'Too many HD calls are running at once.';
    else if (err instanceof sdk.MediaAccessError) (message = 'Microphone or camera access was blocked.'), (fallback = false);
    else if (err instanceof sdk.WebRTCUnavailableError) message = 'This browser can’t do HD video calls.';
    throw { code, message, fallback };
  }
}

export async function endHD() {
  const c = convo;
  convo = null;
  try {
    await c?.disconnect();
  } catch {}
  $('#hdVideo').srcObject = null;
}

export const hd = {
  get active() {
    return !!convo;
  },
  async toggleMic() {
    if (!convo) return true;
    convo.user.isMuted ? await convo.user.unmuteAudio() : await convo.user.muteAudio();
    return !convo.user.isMuted;
  },
  async toggleCam() {
    if (!convo) return false;
    convo.user.isVideoEnabled ? await convo.user.disableVideo() : await convo.user.enableVideo();
    if (convo.user.videoTrack) convo.user.videoTrack.attach($('#selfView'));
    return convo.user.isVideoEnabled;
  },
};
