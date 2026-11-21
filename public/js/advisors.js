// What the lobby shows for each advisor. Their briefing lives server-side in netlify/lib.
export const ADVISORS = [
  {
    id: 'joy',
    name: 'Joy',
    focus: 'Strategy, growth and founder decisions',
    face: 'sonia',
  },
  {
    id: 'osas',
    name: 'Osas',
    focus: 'Marketing, sales, customers and relationships',
    face: 'mira',
  },
  {
    id: 'greg',
    name: 'Greg',
    focus: 'Market research, data, tech and finance',
    face: 'sam',
  },
];

// Nuance Labs' live video personas. They set only how an advisor looks and sounds.
export const FACES = { sam: 'Sam', sonia: 'Sonia', mira: 'Mira' };

export const SUPPORT = { display: '0706 645 9689', tel: '+2347066459689', whatsapp: '2347066459689' };
