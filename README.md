# Blaiselabs: AI advisors, face to face

Blaiselabs lets you talk with AI advisors (Joy, Osas and Greg) on a live video call. Ask them about business strategy, growth, market research, marketing and sales, finance and fundraising, leadership, technology, or relationships, and they listen and answer out loud.

Built by Micheal Blaise, founder of Analaize Limited. Support Blaise's journey: 0706 645 9689.

## How it works

- **Video and voice** run on Nuance Labs' real-time persona model through their JavaScript SDK, which is bundled in `public/vendor/nuance-sdk.js` (Apache-2.0).
- **Starting a call:** `netlify/functions/nuance-token.mjs` creates a single-use session token. It briefs two parts of the advisor:
  - **The persona** is the face you talk to. It gets the advisor's personality, its opening line, and the facts about Blaise and Analaize. See `netlify/lib/prompts.mjs`.
  - **The research backend** is the brain the persona hands deeper questions to. It gets about 36,000 characters of playbooks from `netlify/lib/knowledge/`, and thinks at medium effort before answering.
- **No captions:** the call screen shows no subtitles. Advisors only listen to your voice.

## Deploy

1. Push this folder to GitHub, then import the repo in Netlify. No build settings are needed.
2. In Netlify, open **Project configuration → Environment variables** and add `NUANCE_API_KEY` (your `nk_…` key). Tick **Contains secret values**.
3. Deploy, then open the site in Chrome, Edge or Safari and allow the microphone.

## Edit what the advisors know

| To change | Edit |
|---|---|
| Facts about Blaise, Analaize, or the support line | `netlify/lib/knowledge.mjs` |
| An advisor's personality or focus | `netlify/lib/agents.mjs` |
| Playbooks: strategy, growth, research, sales and finance, people and tech, relationships and Africa, industries | `netlify/lib/knowledge/*.mjs` |
| How advisors behave on calls | `netlify/lib/prompts.mjs` |
| Lobby text, default faces, support number | `public/js/advisors.js`, `public/index.html` |

Keep everything in English: Nuance personas speak English only, and Nuance refuses prompts that ask for other languages. The research backend's brief must stay under 65,536 characters (currently about 36,000).

## Faces

Nuance offers three personas, Sam, Sonia and Mira, which set only how an advisor looks and sounds. Each advisor's face can be changed in the lobby. The choice is saved on that device.

## Limits

- Calls use Nuance credits and are capped at 15 minutes.
- If all lines are busy or credits run out, the lobby says so; try again later.
- Advisors are AI, they can make mistakes, and they cannot browse the internet. The site says this before the first call and on the call screen.
