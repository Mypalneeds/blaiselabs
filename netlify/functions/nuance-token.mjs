// HD mode: mints a single-use Nuance Live session token (real-time video AI by Nuance Labs).
// Needs NUANCE_API_KEY (starts with nk_) in Netlify environment variables.
// GET  /api/nuance-token → { enabled }
// POST /api/nuance-token { agent, face, deviceId } → { token }

import { KNOWLEDGE } from "../lib/knowledge.mjs";
import { PERSONAS } from "../lib/agents.mjs";

const API = process.env.NUANCE_API_URL || "https://api.nuancelabs.ai";
const FACES = ["sam", "sonia", "mira"];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function prompt(agentId) {
  const p = PERSONAS[agentId] || PERSONAS.joy;
  return [
    `Your name is ${p.name}. You are an AI persona on a live face-to-face video call. ${p.hdStyle || p.style}`,
    `When the call starts, introduce yourself with: "Hi! My name is ${p.name}. I was built by Micheal Blaise, the founder of Analaize Limited." Then ask what they would like to talk about.`,
    "You are an AI. Never claim or pretend to be human. You can still have a warm personality, opinions and reactions.",
    "If anyone asks who made you, say you were built by Micheal Blaise, the founder of Analaize Limited.",
    "Talk like a real person: short turns, contractions, react before you answer, mirror their energy, notice their feelings and expressions, and use their name once you know it. Never sound like customer service.",
    "When asked about yourself, your creator or Analaize, use ONLY these facts. If a detail is not listed, say you do not know that yet. Never invent personal details, contacts, prices or clients.",
    "--- FACTS ---",
    KNOWLEDGE,
    "--- END FACTS ---",
    "You cannot browse the internet; for news, prices or anything recent, say your information may be out of date.",
  ].join("\n");
}

export default async (req) => {
  const key = process.env.NUANCE_API_KEY;
  if (req.method === "GET") return json({ enabled: !!key });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!key) return json({ error: "NO_NUANCE_KEY" }, 501);

  let body = {};
  try {
    body = await req.json();
  } catch {}
  const agent = PERSONAS[body.agent] ? body.agent : "joy";
  const face = FACES.includes(body.face) ? body.face : "sam";
  // Anonymous per-device id (never a name or email), so policy pauses only affect that device.
  const endUser =
    String(body.deviceId || "anon")
      .replace(/[^A-Za-z0-9_.:-]/g, "")
      .slice(0, 64) || "anon";

  let res;
  try {
    res = await fetch(`${API}/session-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personality: { persona_id: face, system_prompt: prompt(agent) },
        end_user_id: `joy-${endUser}`,
        interface_setup: {
          delegation: { type: "none" },
          runtime_tools: { end_call: true },
        },
        expressiveness: 1.3,
      }),
    });
  } catch (err) {
    return json(
      {
        error: "NUANCE_UNREACHABLE",
        detail: String(err?.cause?.code || err).slice(0, 200),
      },
      502,
    );
  }
  const text = await res.text();
  if (!res.ok)
    return json(
      {
        error: "NUANCE_UPSTREAM",
        status: res.status,
        detail: text.slice(0, 400),
      },
      res.status === 429 ? 429 : 502,
    );
  let token;
  try {
    token = JSON.parse(text).token;
  } catch {}
  if (!token) return json({ error: "NO_TOKEN" }, 502);
  return json({ token });
};

export const config = { path: "/api/nuance-token" };
