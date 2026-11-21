// Optional studio voices via ElevenLabs. Enabled only when ELEVENLABS_API_KEY is set.
// GET  /api/tts → { enabled }
// POST /api/tts { text, persona } → audio/mpeg

const DEFAULT_VOICES = {
  // ElevenLabs premade voices; override per agent with env vars (voice IDs from your ElevenLabs Voice Library).
  joy: process.env.ELEVENLABS_VOICE_JOY || '21m00Tcm4TlvDq8ikWAM',
  osas: process.env.ELEVENLABS_VOICE_OSAS || 'EXAVITQu4vr4xnSDxMaL',
  greg: process.env.ELEVENLABS_VOICE_GREG || 'pNInz6obpgDQGcFmaJgB',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (req.method === 'GET') return json({ enabled: !!key });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!key) return json({ error: 'NO_ELEVEN_KEY' }, 501);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BAD_JSON' }, 400);
  }
  const text = String(body.text || '').trim().slice(0, 600);
  if (!text) return json({ error: 'NO_TEXT' }, 400);
  const voice = DEFAULT_VOICES[body.persona] || DEFAULT_VOICES.joy;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: 'ELEVEN_UPSTREAM', status: res.status, detail: detail.slice(0, 300) }, 502);
  }
  return new Response(res.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
};

export const config = { path: '/api/tts' };
