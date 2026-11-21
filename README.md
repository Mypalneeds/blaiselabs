# Joy & friends: talk face to face with AI

Joy, Osas and Greg are real-time AI video personas built by **Micheal Blaise, founder of Analaize Limited**. Pick one, press **Talk**, and speak out loud. The animated face listens and nods while you speak, then answers with a matching expression and a moving mouth. You can interrupt it mid-sentence, just like a real call.

- **Three agents:** Joy (a warm all-rounder), Osas (lively, with Naija energy, and she speaks Pidgin back) and Greg (calm, with a business and tech focus). Each introduces themselves: "Hi! My name is … I was built by Micheal Blaise, the founder of Analaize Limited."
- **Changeable skin tones:** tap a swatch in the lobby or in Settings, or just ask out loud ("make your skin darker"). The choice is remembered for each agent.
- **Editable memory:** what she knows about her creator and Analaize lives in one file
- **Free to run:** browser-native speech recognition and voices, a free LLM tier, and Netlify's free plan
- **No build step:** plain HTML, CSS and JS, plus one serverless function
- **Phone-first UI:** captions, a typing fallback, an optional camera self-view, and settings for language and voice

## What makes them feel human

- **Faces:** they have 12 emotions, including laugh, excited, sad, empathetic, skeptical and embarrassed, which they can switch mid-sentence. They also show:
  - micro-expressions and lopsided brows
  - blinks timed to glances, and tiny eye movements
  - a visible breath before answering
  - nods and head tilts timed to their sentences
  - lip-sync driven by the actual audio
- **Instant reactions:** while the AI thinks, they say a quick "Hmm," "Oh!" or "Aww," fitted to what you said, so there's never dead silence.
- **Conversation style:** they react before answering, mirror your energy, pick up on feelings, use your name and avoid customer-service phrasing.
- **Camera (optional):** your face is read on your device with MediaPipe, and nothing is uploaded. They keep eye contact, smile when you smile, look concerned when you frown, and the AI is told how you looked while speaking.
- **Memory:** each agent remembers recent conversations on your device, greets you with "welcome back" and knows the time of day. You can clear this in Settings with **Forget all conversations**.
- **Voices** (Settings → Voice quality):
  - **Natural:** Kokoro, a free open-source neural voice that runs in the browser. It needs a one-time download of about 90 MB and only speaks English.
  - **Studio:** ElevenLabs. Set `ELEVENLABS_API_KEY` on Netlify. You can optionally pick a voice for each agent with `ELEVENLABS_VOICE_JOY`, `_OSAS` and `_GREG`.
  - **Basic:** the device's own voice, which plays instantly.

## How it works

```
mic ─▶ Web Speech API (speech-to-text, in browser)
        │  end-of-turn detection (~850 ms pause)
        ▼
/api/chat  (Netlify Function) ─▶ any OpenAI-compatible LLM (default: Groq, free)
        │  streamed tokens, starting with an [emotion] tag
        ▼
sentence splitter ─▶ speechSynthesis (in browser) ─▶ SVG avatar
                                   word boundaries ─▶ mouth shapes
                                   emotion tag     ─▶ face expression
```

The avatar is fully procedural, drawn in SVG, and needs no video model. It blinks, shifts its gaze, breathes, nods while you talk, glances away while thinking, and lip-syncs to the spoken words.

## Deploy (about 5 minutes)

1. **Get a free LLM key** at <https://console.groq.com/keys>.
2. **Push to GitHub:**
   ```bash
   git init && git add . && git commit -m "Joy v1"
   gh repo create joy --public --source=. --push   # or create the repo on github.com and push
   ```
3. **Netlify:** go to **Add new site → Import from Git**, then pick the repo. The settings are read from `netlify.toml` automatically: the publish directory is `public` and the functions directory is `netlify/functions`.
4. **Environment variables:** open **Site configuration → Environment variables** and add:
   - `LLM_API_KEY`: your Groq key
   - `LLM_MODEL` (optional): defaults to `openai/gpt-oss-20b`
   - `ELEVENLABS_API_KEY` (optional): turns on Studio voices
   - `LLM_BASE_URL` (optional): defaults to Groq. OpenRouter and Gemini's OpenAI-compatible endpoint also work (see `.env.example`).
5. Redeploy and open the site on your phone. Allow microphone access when asked.

If you skip step 4, visitors can paste their own free key in **Settings**. It is stored only in their browser.

## Run locally

```bash
npm i -g netlify-cli
cp .env.example .env   # add your key
netlify dev            # → http://localhost:8888
```

Opening `index.html` directly won't work, because the page needs the `/api/chat` function.

## Update Joy's memory

Edit `netlify/functions/knowledge.mjs` and write plain facts as bullet points. Then commit and push, and Netlify redeploys in about a minute. All three agents share this memory. They only state facts from this file about themselves, Blaise and Analaize. If a detail isn't there, she says she doesn't know it yet.

To change how a name is *pronounced* (but not spelled in captions), edit `PRONOUNCE` in `public/js/voice.js`.

## Customise

- **Agents:** each agent's look, voice, greeting and default skin tone are in `public/js/personas.js`. Its personality is in `netlify/functions/chat.mjs` (`PERSONAS`). To add an agent, add an entry with the same id in both files.
- **Skin tones:** see `SKIN_TONES` in `public/js/avatar.js`. If you add a tone, also add its name to `SKINS` in `chat.mjs`.
- **Expressions:** see `EXPRESSIONS` in `public/js/avatar.js`.
- **Turn-taking speed:** see `END_OF_TURN_MS` in `public/js/app.js`.

## Browser support

| | Voice in | Voice out |
|---|---|---|
| Chrome / Edge (desktop & Android) | ✅ | ✅ |
| Safari (macOS & iOS) | ✅ | ✅ |
| Firefox | ❌ (typing fallback) | ✅ |

Speech recognition in Chrome uses Google's servers, so it needs an internet connection. Voice quality depends on the voices installed on the device.

## Limits, and how to grow it

- **Response time:** expect about 1–2 s, because this is a chained pipeline (speech-to-text → LLM → TTS), not a single audio-visual model.
- **Echo:** on phone speakers, the mic can hear the avatar talking. Joy filters transcripts that match its own speech, but headphones work best.
- **Abuse:** a public site with your key in `LLM_API_KEY` can be used by anyone. Groq's free tier has rate limits. To lock it down, add Netlify's rate limiting or an access code.
- **Upgrade path:** to go beyond the free stack, swap `speechSynthesis` for ElevenLabs or Cartesia, or replace the SVG face with a streaming avatar API (Tavus, Simli, HeyGen). The rest of the app stays the same.

## Responsible use

Every agent is instructed to say it is an AI and never claim to be human, and the UI always shows an **AI** badge. The faces are original characters and are not based on any real person.

MIT licensed. © 2026 Analaize Limited.
