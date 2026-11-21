// Starts a call: mints a single-use Nuance Live session token with the advisor's brief.
// Needs NUANCE_API_KEY (starts with nk_) in Netlify environment variables.
//   GET  /api/nuance-token → { enabled }
//   POST /api/nuance-token { agent, face, deviceId } → { token }

import { PERSONAS, FACES } from '../lib/agents.mjs';
import { persona, researchBrief } from '../lib/prompts.mjs';

const API = process.env.NUANCE_API_URL || 'https://api.nuancelabs.ai';
const MAX_INSTRUCTIONS = 65000; // Nuance limit for backend instructions is 65,536 characters

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  const key = process.env.NUANCE_API_KEY;
  if (req.method === 'GET') return json({ enabled: Boolean(key) });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!key) return json({ error: 'NO_NUANCE_KEY', detail: 'Set NUANCE_API_KEY in Netlify.' }, 501);

  let body = {};
  try {
    body = await req.json();
  } catch {
    /* use defaults */
  }
  const agent = PERSONAS[body.agent] ? body.agent : 'joy';
  const face = FACES.includes(body.face) ? body.face : 'sonia';
  // Anonymous per-device id (never a name or email) so a policy pause only affects that device.
  const endUser = String(body.deviceId || 'anon').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64) || 'anon';

  const payload = {
    personality: { persona_id: face, system_prompt: persona(agent) },
    end_user_id: `blaiselabs-${endUser}`,
    expressiveness: 1.2,
    interface_setup: {
      delegation: {
        type: 'responses',
        responses: {
          model: 'advisor',
          instructions: researchBrief(agent).slice(0, MAX_INSTRUCTIONS),
          reasoning: { effort: 'medium' },
          max_output_tokens: 2000,
        },
      },
      runtime_tools: { end_call: true },
    },
  };

  let res;
  try {
    res = await fetch(`${API}/session-tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json({ error: 'NUANCE_UNREACHABLE', detail: String(err?.cause?.code || err).slice(0, 200) }, 502);
  }

  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 400);
    try {
      detail = JSON.parse(text)?.error?.message || detail;
    } catch {
      /* keep raw */
    }
    return json({ error: 'NUANCE_REFUSED', status: res.status, detail }, res.status === 429 ? 429 : 502);
  }

  try {
    const { token } = JSON.parse(text);
    if (token) return json({ token });
  } catch {
    /* fall through */
  }
  return json({ error: 'NO_TOKEN' }, 502);
};

export const config = { path: '/api/nuance-token' };
