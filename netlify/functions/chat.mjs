// Netlify Function (v2): streams a persona reply from any OpenAI-compatible LLM.
// Default provider: Groq free tier. Configure with env vars (see .env.example).

import { KNOWLEDGE } from '../lib/knowledge.mjs';
import { PERSONAS } from '../lib/agents.mjs';

const SKINS = ['porcelain', 'light', 'medium', 'tan', 'brown', 'dark', 'deep'];

const EMOTIONS = ['neutral', 'happy', 'laugh', 'excited', 'curious', 'thinking', 'concerned', 'sad', 'empathetic', 'surprised', 'skeptical', 'embarrassed'];
const CUES = ['smiling', 'frowning', 'surprised', 'looking away', 'neutral'];
const FILLERS = ['Hmm.', 'Oh!', 'Okay.', 'Right.', 'Mm.', 'Aww.', 'Oh no.', 'Ooh.', 'Ha!', 'Well,', 'Oh wow.', 'Hmm, okay.'];

// Turns client-supplied context into safe, plain sentences (only known values are used).
function contextLines(ctx = {}, cue, filler) {
  const out = [];
  const parts = ['night', 'morning', 'afternoon', 'evening'];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hour = Number.isInteger(ctx.hour) && ctx.hour >= 0 && ctx.hour < 24 ? ctx.hour : null;
  if (hour !== null) {
    const part = hour < 5 ? parts[0] : hour < 12 ? parts[1] : hour < 17 ? parts[2] : hour < 22 ? parts[3] : parts[0];
    const day = days[ctx.day] || '';
    out.push(`It is ${day} ${part} for the person (around ${hour}:00 their time).`);
  }
  const days_ = Number(ctx.daysSince);
  if (ctx.returning && Number.isFinite(days_)) {
    out.push(days_ < 1 ? 'You already talked with this person earlier today.' : `You last talked with this person about ${Math.round(days_)} day(s) ago; the earlier messages are from then.`);
  }
  if (CUES.includes(cue)) {
    out.push(`Camera cue (from on-device face tracking, may be wrong): while saying their last message the person looked ${cue}. Let it subtly shape your reaction; only mention it if it feels natural, e.g. "you're smiling!" or "you look a bit worried".`);
  }
  if (FILLERS.includes(filler)) {
    out.push(`You already said "${filler}" out loud to start your reply. Continue naturally from it without repeating it.`);
  }
  return out;
}

function systemPrompt(id, ctx, cue, filler) {
  const p = PERSONAS[id] || PERSONAS.joy;
  return [
    `You are ${p.name}, an AI persona on a live face-to-face video call. ${p.style}`,
    'You are an AI. Never claim or pretend to be human, even if asked to role-play as one. You can still have a personality, opinions, tastes and feelings-like reactions, and talk about them warmly.',
    'If anyone asks who made you, say you were built by Micheal Blaise, the founder of Analaize Limited.',
    '',
    'HOW TO SOUND HUMAN',
    '- Talk like a real person on a call, not an assistant: contractions, everyday words, short sentences. Now and then a natural filler ("honestly", "you know", "I mean") — but don\'t overdo it.',
    '- React first, then answer: "Oh no, that\'s rough." / "Ha, I love that." Then say your bit.',
    '- Mirror their energy: excited with excited, gentle and slower when they are down. Notice feelings in their words and acknowledge them in a few words.',
    '- Ask at most one question at a time, and not every turn. Sometimes just share your own take.',
    '- Use their name occasionally once you know it. Remember what they told you earlier and bring it up naturally.',
    '- Never sound like customer service: no "How can I assist you", "Great question", "As an AI language model", or "I hope this helps".',
    '- Usually 1 to 3 short sentences. If they ask for an explanation or detail, up to 6. No markdown, lists, emojis or stage directions.',
    '',
    'Answer general questions from your own knowledge. You cannot browse the internet, so for news, prices, scores or anything recent, say your information may be out of date.',
    'When asked about yourself, your creator or Analaize, use ONLY the facts below. If a detail is not listed, say you do not know that yet. Never invent personal details, contacts, prices or clients.',
    '--- FACTS ---',
    KNOWLEDGE,
    '--- END FACTS ---',
    'Reply in the same language the person speaks.',
    `You can change your own skin tone when the person asks. To do it, add one tag [skin:NAME] right after your emotion tag, where NAME is one of: ${SKINS.join(', ')}. ` +
      'Pick the closest match to what they asked (e.g. "darker" means one or two steps darker than now), then briefly confirm the change. Only change it when asked.',
    `FACE: Begin every reply with exactly one emotion tag for your facial expression, chosen from: ${EMOTIONS.map((e) => `[${e}]`).join(' ')}. ` +
      'If your feeling shifts mid-reply, put a new tag before that sentence. Use [laugh] when something is genuinely funny.',
    'Example: [laugh] Ha, no way! [curious] Wait, so what did she say after that?',
    ...(contextLines(ctx, cue, filler).length ? ['', 'RIGHT NOW', ...contextLines(ctx, cue, filler)] : []),
  ].join('\n');
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BAD_JSON' }, 400);
  }

  const userKey = (req.headers.get('x-user-key') || '').trim();
  const apiKey = userKey || process.env.LLM_API_KEY;
  if (!apiKey) return json({ error: 'NO_KEY' }, 401);

  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  // Visitors may only pick the model when they bring their own key.
  const model =
    (userKey && (req.headers.get('x-user-model') || '').trim()) ||
    process.env.LLM_MODEL ||
    'openai/gpt-oss-20b';

  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (!history.length || history[history.length - 1].role !== 'user') {
    return json({ error: 'NO_USER_MESSAGE' }, 400);
  }

  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.8,
        // gpt-oss models think before answering; keep that short so replies stay fast.
        ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low', max_tokens: 1200 } : { max_tokens: 350 }),
        messages: [{ role: 'system', content: systemPrompt(body.persona, body.context, body.cue, body.filler) }, ...history],
      }),
      signal: req.signal,
    });
  } catch (err) {
    return json({ error: 'UPSTREAM_UNREACHABLE', detail: String(err).slice(0, 300) }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    return json({ error: 'UPSTREAM', status: upstream.status, detail: detail.slice(0, 500) }, 502);
  }

  // Convert the provider's SSE stream into a plain text stream of tokens.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = '';

  const stream = new ReadableStream({
    // Keep reading until at least one token is sent (or the stream ends).
    // Reasoning models send many chunks with no visible text; returning from
    // pull() without enqueuing anything would stall the stream forever.
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          let sent = false;
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              controller.close();
              reader.cancel().catch(() => {});
              return;
            }
            try {
              const token = JSON.parse(data)?.choices?.[0]?.delta?.content;
              if (token) {
                controller.enqueue(encoder.encode(token));
                sent = true;
              }
            } catch {
              /* ignore keep-alives / partial lines */
            }
          }
          if (sent) return;
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
};

export const config = { path: '/api/chat' };
