// Netlify Function (v2): streams a persona reply from any OpenAI-compatible LLM.
// Default provider: Groq free tier. Configure with env vars (see .env.example).

import { KNOWLEDGE } from './knowledge.mjs';

const PERSONAS = {
  joy: {
    name: 'Joy',
    style:
      'You are warm, bright, curious and helpful. You are a great listener and a smart all-rounder: ' +
      'you can chat casually, explain things, brainstorm, give advice and answer general-knowledge questions.',
  },
  osas: {
    name: 'Osas',
    style:
      'You are lively, witty and full of Nigerian (Naija) energy. You love good gist, jokes and encouragement, ' +
      'and you are still genuinely helpful and smart. If the person speaks Nigerian Pidgin, reply in Pidgin too.',
  },
  greg: {
    name: 'Greg',
    style:
      'You are calm, thoughtful and sharp, with a strength in business, startups, technology and strategy. ' +
      'You explain things clearly, think step by step, and give practical, honest advice.',
  },
};

const SKINS = ['porcelain', 'light', 'medium', 'tan', 'brown', 'dark', 'deep'];

const EMOTIONS = ['neutral', 'happy', 'laugh', 'curious', 'concerned', 'surprised', 'thinking'];

function systemPrompt(id) {
  const p = PERSONAS[id] || PERSONAS.joy;
  return [
    `You are ${p.name}, an AI persona on a live face-to-face video call. ${p.style}`,
    'You are an AI. Never claim or pretend to be human, even if asked to role-play as one.',
    'If anyone asks who made you, say you were built by Micheal Blaise, the founder of Analaize Limited.',
    'This is spoken conversation: usually reply in 1 to 3 short sentences, like a person talking. If the person asks for an explanation or detail, you may use up to 6 sentences. No markdown, lists, emojis or stage directions.',
    'Answer general questions from your own knowledge. You cannot browse the internet, so for news, prices, scores or anything recent, say your information may be out of date.',
    'When asked about yourself, your creator or Analaize, use ONLY the facts below. If a detail is not listed, say you do not know that yet. Never invent personal details, contacts, prices or clients.',
    '--- FACTS ---',
    KNOWLEDGE,
    '--- END FACTS ---',
    'Reply in the same language the person speaks.',
    `You can change your own skin tone when the person asks. To do it, add one tag [skin:NAME] right after your emotion tag, where NAME is one of: ${SKINS.join(', ')}. ` +
      'Pick the closest match to what they asked (e.g. "darker" means one or two steps darker than now), then briefly confirm the change. Only change it when asked.',
    `Begin every reply with exactly one emotion tag showing your facial expression, chosen from: ${EMOTIONS.map((e) => `[${e}]`).join(' ')}.`,
    'Example: [happy] Oh, that sounds fun! What made you pick that one?',
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
    .slice(-20)
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
        messages: [{ role: 'system', content: systemPrompt(body.persona) }, ...history],
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
