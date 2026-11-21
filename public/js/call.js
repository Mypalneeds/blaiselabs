// One live video call with an advisor, via Nuance Labs' JavaScript SDK (bundled in /vendor).

let sdk = null;
let convo = null;

function deviceId() {
  try {
    let id = localStorage.getItem('blaiselabs.device');
    if (!id) {
      id = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('blaiselabs.device', id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

export async function callsEnabled() {
  try {
    const res = await fetch('/api/nuance-token');
    return res.ok && Boolean((await res.json()).enabled);
  } catch {
    return false;
  }
}

/**
 * Starts a call. `on` receives:
 *   status(state)  'connecting' | 'waiting' | 'preparing' | 'listening' | 'thinking' | 'speaking'
 *   notice(text)   short message for the person
 *   ended(reason)
 * Rejects with an Error whose message is written for the person.
 */
export async function startCall({ advisor, face, video, audio, selfView, on }) {
  sdk ??= await import('../vendor/nuance-sdk.js');

  convo = sdk.createNuanceConversation({
    token: async () => {
      const res = await fetch('/api/nuance-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: advisor.id, face, deviceId: deviceId() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) {
        throw Object.assign(new Error(body.detail || body.error || `Token request failed (${res.status})`), { status: res.status });
      }
      return body.token;
    },
    maxSessionSeconds: 900,
    mediaDevices: { cameraEnabled: false, cameraFacing: 'user' },
    videoCapture: { width: 640, height: 480 },
  });

  const attachSelf = () => {
    const track = convo?.user.videoTrack;
    if (track) track.attach(selfView);
  };

  convo.onChange((e) => {
    switch (e.type) {
      case 'state-changed':
        if (e.state === 'connecting') on.status('connecting');
        if (e.state === 'queued') on.status('waiting');
        break;
      case 'avatar-preparing':
        on.status('preparing');
        break;
      case 'tracks-changed':
        convo.avatar.videoTrack?.attach(video);
        convo.avatar.audioTrack?.attach(audio);
        attachSelf();
        break;
      case 'camera-changed':
        attachSelf();
        break;
      case 'avatar-presented':
        on.status('listening');
        convo.sendInterfaceEvent({ type: 'response.create', response: { instructions: 'Start the call now with your opening.' } }).catch(() => {});
        break;
      case 'network-changed':
        if (e.quality === 'poor' || e.network === 'poor') on.notice('Your connection is weak, so the video may stutter.');
        break;
      case 'time-remaining':
        if (typeof e.seconds === 'number' && e.seconds <= 60 && e.seconds > 55) on.notice('About a minute left on this call.');
        break;
      case 'session-ended':
        on.ended(e.reason);
        break;
    }
  });

  convo.onInterfaceEvent((ev) => {
    switch (ev.type) {
      case 'session.input_transcript.delta':
        on.status('listening');
        break;
      case 'session.delegation.created':
        on.status('thinking');
        break;
      case 'session.output_transcript.delta':
        on.status('speaking');
        break;
      case 'session.output_audio.done':
        on.status('listening');
        break;
    }
  });

  try {
    await convo.connect();
  } catch (err) {
    convo = null;
    throw new Error(explain(err));
  }
}

function explain(err) {
  const text = `${err?.message || ''} ${err?.code || ''} ${err?.status || ''}`;
  if (sdk && err instanceof sdk.MediaAccessError) return 'Microphone access is blocked. Allow it in your browser settings and try again.';
  if (sdk && err instanceof sdk.WebRTCUnavailableError) return 'This browser can’t make video calls. Try the latest Chrome, Edge or Safari.';
  if (sdk && err instanceof sdk.ActiveSessionError) return 'Too many calls are running right now. Try again in a minute.';
  if (/credits_spent/.test(text)) return 'Today’s call minutes are used up. Calls reset at midnight UTC.';
  if (/capacity|busy|429|503/.test(text)) return 'All advisors are busy right now. Try again in a minute.';
  if (/NO_NUANCE_KEY|501/.test(text)) return 'Calls aren’t set up yet: add NUANCE_API_KEY in Netlify.';
  return `The call couldn’t start: ${err?.message || 'unknown error'}`;
}

export async function endCall() {
  const c = convo;
  convo = null;
  try {
    await c?.disconnect();
  } catch {
    /* already gone */
  }
}

export async function toggleMic() {
  if (!convo) return false;
  if (convo.user.isMuted) await convo.user.unmuteAudio();
  else await convo.user.muteAudio();
  return !convo.user.isMuted;
}

export async function toggleCamera() {
  if (!convo) return false;
  if (convo.user.isVideoEnabled) await convo.user.disableVideo();
  else await convo.user.enableVideo();
  return convo.user.isVideoEnabled;
}
