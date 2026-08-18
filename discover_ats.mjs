// استكشاف: يفحص أسماء شركات على منصّات ATS ويقبل فقط اللي عندها وظائف سعودية فعلية.
import axios from 'axios';

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' };
const SA = /saudi|riyadh|jeddah|dammam|khobar|dhahran|jubail|makkah|madinah|neom|السعودية|الرياض|جدة/i;

const SLUGS = [
  'tabby','tamara','foodics','unifonic','nana','lean','sary','trukker','halan','floward',
  'jahez','hungerstation','mrsool','stcpay','rasan','geidea','zid','salla','sarwa','telda',
  'careem','swvl','vezeeta','yassir','instabug','paymob','fawry','opay','moneyhash','flow48',
  'neom','aramco','sabic','stc','almarai','maaden','acwapower','alinma','riyadbank','snbcapital',
  'noon','amazon','deliveryhero','talabat','property-finder','bayut','dubizzle','emaar',
  'sary-sa','redsea','redseaglobal','diriyah','qiddiya','roshn','soudah','nhc','tahakom',
  'elm','thiqah','takamol','sirar','solutions','mozn','sirbeacon','lucidmotors','ceer',
];

const PLATFORMS = [
  { name: 'greenhouse', url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=false`,
    parse: d => (d.jobs || []).map(j => ({ t: j.title, l: j.location?.name || '' })) },
  { name: 'lever', url: s => `https://api.lever.co/v0/postings/${s}?mode=json`,
    parse: d => (Array.isArray(d) ? d : []).map(j => ({ t: j.text, l: j.categories?.location || '' })) },
  { name: 'ashby', url: s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    parse: d => (d.jobs || []).map(j => ({ t: j.title, l: j.location || '' })) },
  { name: 'workable', url: s => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`,
    parse: d => (d.jobs || []).map(j => ({ t: j.title, l: `${j.city || ''} ${j.country || ''}` })) },
  { name: 'recruitee', url: s => `https://${s}.recruitee.com/api/offers/`,
    parse: d => (d.offers || []).map(j => ({ t: j.title, l: `${j.city || ''} ${j.country || ''}` })) },
  { name: 'smartrecruiters', url: s => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`,
    parse: d => (d.content || []).map(j => ({ t: j.name, l: `${j.location?.city || ''} ${j.location?.country || ''}` })) },
  { name: 'teamtailor', url: s => `https://${s}.teamtailor.com/jobs.json`,
    parse: d => (d.jobs || []).map(j => ({ t: j.title, l: j.locality || '' })) },
];

const hits = [];
let checked = 0;

async function probe(p, slug) {
  checked++;
  try {
    const { data } = await axios.get(p.url(slug), { timeout: 12000, headers: UA, validateStatus: null });
    const jobs = p.parse(data) || [];
    if (!jobs.length) return;
    const sa = jobs.filter(j => SA.test(`${j.t} ${j.l}`));
    if (sa.length) {
      hits.push({ platform: p.name, slug, total: jobs.length, saudi: sa.length, sample: sa.slice(0, 3) });
      console.log(`✅ ${p.name.padEnd(15)} ${slug.padEnd(18)} total=${String(jobs.length).padEnd(4)} saudi=${sa.length}`);
      sa.slice(0, 2).forEach(j => console.log(`      - ${j.t} | ${j.l}`));
    }
  } catch { /* 404/timeout = لا يوجد */ }
}

const tasks = [];
for (const p of PLATFORMS) for (const s of SLUGS) tasks.push([p, s]);

const CONC = 12;
let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < tasks.length) {
    const n = i++;
    await probe(tasks[n][0], tasks[n][1]);
  }
}));

console.log(`\n--- فُحص ${checked} تركيبة | نتائج فيها وظائف سعودية: ${hits.length} ---`);
console.log(JSON.stringify(hits, null, 1));
