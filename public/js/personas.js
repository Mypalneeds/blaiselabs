// Client-side look & voice for each agent. Personalities live server-side
// in netlify/functions/chat.mjs (same ids) so the endpoint can't be used as a general LLM proxy.
// `skin` is the default tone; users can change it (see SKIN_TONES in avatar.js).

const back = (name) => `[happy] Hey, welcome back! It's ${name}. Good to see you again — what's new?`;
const intro = (name, emotion = 'happy') =>
  `[${emotion}] Hi! My name is ${name}. I was built by Micheal Blaise, the founder of Analaize Limited. What would you like to talk about?`;

export const PERSONAS = {
  joy: {
    id: 'joy',
    name: 'Joy',
    tagline: 'Warm, bright all-rounder',
    skin: 'brown',
    greeting: intro('Joy'),
    welcomeBack: back('Joy'),
    voice: { prefer: ['Samantha', 'Google UK English Female', 'Microsoft Aria', 'Microsoft Jenny', 'Microsoft Sonia', 'Karen', 'Moira', 'Tessa', 'Female'], gender: 'female', pitch: 1.08, rate: 1.02, kokoro: 'af_heart' },
    look: {
      name: 'Joy',
      bg: ['#ffe9d6', '#f2a97e'],
      skin: ['#b9805a', '#8d5b3c'],
      blush: '#d0625a',
      lip: '#6e2f2f',
      iris: '#4a2c1a',
      lash: '#241510',
      brow: '#20130d',
      hair: '#1d1310',
      shirt: '#2f6f73',
      hairBack:
        'M96 220 C80 120 140 70 200 70 C270 70 325 120 305 225 C330 260 320 330 290 340 C300 290 296 250 288 220 C250 150 150 150 112 220 C104 250 100 290 110 340 C80 330 72 260 96 220 Z',
      hairFront: 'M104 200 C110 110 170 82 210 86 C260 90 300 130 296 196 C270 150 230 128 200 140 C160 128 130 150 104 200 Z',
      extra: [
        { tag: 'circle', attrs: { cx: 200, cy: 62, r: 34, fill: '#1d1310' } },
        { tag: 'circle', attrs: { cx: 106, cy: 252, r: 5, fill: '#f2c14e' } },
        { tag: 'circle', attrs: { cx: 294, cy: 252, r: 5, fill: '#f2c14e' } },
      ],
    },
  },

  osas: {
    id: 'osas',
    name: 'Osas',
    tagline: 'Lively, witty, full of Naija energy',
    skin: 'dark',
    greeting: intro('Osas', 'laugh'),
    welcomeBack: "[laugh] Ahh, you're back! It's Osas. How far, what's the gist?",
    voice: { prefer: ['Google UK English Female', 'Microsoft Libby', 'Microsoft Ezinne', 'Microsoft Sonia', 'Moira', 'Tessa', 'Karen', 'Samantha', 'Female'], gender: 'female', pitch: 1.18, rate: 1.06, kokoro: 'af_bella', kokoroSpeed: 1.05 },
    look: {
      name: 'Osas',
      bg: ['#fff3c4', '#e9a23b'],
      skin: ['#8a5a3c', '#664028'],
      blush: '#a8524a',
      lip: '#5a2420',
      iris: '#2a180e',
      lash: '#140b07',
      brow: '#140b07',
      hair: '#120a06',
      shirt: '#7a3fa0',
      // Big afro behind the head
      hairBack: 'M200 40 C300 40 345 110 340 190 C336 250 310 280 296 290 C300 240 298 210 290 190 C260 140 140 140 110 190 C102 210 100 240 104 290 C90 280 64 250 60 190 C55 110 100 40 200 40 Z',
      hairFront: 'M106 192 C112 118 160 92 200 94 C246 92 292 120 296 192 C276 160 244 140 200 142 C156 140 124 160 106 192 Z',
      extra: [
        { tag: 'path', attrs: { d: 'M120 150 Q200 110 280 150', fill: 'none', stroke: '#e9a23b', 'stroke-width': 10, 'stroke-linecap': 'round' } },
        { tag: 'path', attrs: { d: 'M100 246 l6 14 l-6 14 l-6 -14 Z', fill: '#f2c14e' } },
        { tag: 'path', attrs: { d: 'M300 246 l6 14 l-6 14 l-6 -14 Z', fill: '#f2c14e' } },
      ],
    },
  },

  greg: {
    id: 'greg',
    name: 'Greg',
    tagline: 'Calm, sharp business & tech mind',
    skin: 'tan',
    greeting: intro('Greg', 'curious'),
    welcomeBack: back('Greg'),
    voice: { prefer: ['Daniel', 'Google UK English Male', 'Microsoft Guy', 'Microsoft Ryan', 'Microsoft Davis', 'Alex', 'Fred', 'Male'], gender: 'male', pitch: 0.92, rate: 1.0, kokoro: 'am_michael' },
    look: {
      name: 'Greg',
      bg: ['#dde8ff', '#7d93d8'],
      skin: ['#c69072', '#9c6a4e'],
      blush: '#c46a5a',
      lip: '#7a3c34',
      iris: '#2e1d12',
      lash: '#1a120d',
      brow: '#1a120d',
      hair: '#16100c',
      shirt: '#e0663d',
      hairFront: 'M106 196 C100 120 150 86 205 86 C262 86 304 122 296 196 C286 160 262 136 230 132 C200 140 160 132 132 150 C118 162 110 178 106 196 Z',
      extra: [
        { tag: 'rect', attrs: { x: 134, y: 196, width: 56, height: 40, rx: 14, fill: 'rgba(255,255,255,.08)', stroke: '#1a1a1a', 'stroke-width': 5 } },
        { tag: 'rect', attrs: { x: 210, y: 196, width: 56, height: 40, rx: 14, fill: 'rgba(255,255,255,.08)', stroke: '#1a1a1a', 'stroke-width': 5 } },
        { tag: 'path', attrs: { d: 'M190 212 Q200 204 210 212', fill: 'none', stroke: '#1a1a1a', 'stroke-width': 5 } },
      ],
    },
  },
};
