// استكشاف: يفحص مواقع وظائف سعودية/خليجية — هل توصل؟ وهل عندها خلاصة RSS/JSON؟
import axios from 'axios';

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'ar,en;q=0.8'
};

const SITES = [
  'wzif.net', 'sa.tanqeeb.com', 'saudi.tanqeeb.com', 'akhtaboot.com', 'laimoon.com',
  'sa.talent.com', 'talent.com', 'monstergulf.com', 'jobrapido.com', 'sa.jobrapido.com',
  'naukrigulf.com', 'sabbar.com', 'wadhefa.com', 'ewdifh.com', 'hiremena.com',
  'wuzzuf.net', 'tanqeeb.com', 'jobzella.com', 'gulfjobs.com', 'saudijobs.com',
  'qiwa.sa', 'taqat.sa', 'hrdf.org.sa', 'jadarat.sa', 'my.gov.sa',
  'careerjet.com.sa', 'sa.trabajo.org', 'jobs.com.sa', 'mycareer.sa', 'wdeftksa.com',
  'saudi-jobs.co', 'gccjobs.net', 'expatriates.com', 'khaleejtimesjobs.com', 'edarabia.com'
];

// مسارات خلاصات شائعة (ووردبريس + محركات وظائف)
const FEEDS = ['/feed/', '/rss', '/rss.xml', '/feed', '/jobs/feed/', '/ar/feed/', '/sitemap.xml', '/wp-json/wp/v2/posts?per_page=1'];

const get = (url, timeout = 12000) =>
  axios.get(url, { timeout, headers: UA, validateStatus: null, maxRedirects: 3, responseType: 'text' });

async function probeSite(host) {
  const res = { host, root: null, feeds: [] };
  try {
    const r = await get(`https://${host}/`);
    res.root = r.status;
    if (r.status !== 200) return res;
  } catch (e) {
    res.root = e.code || 'ERR';
    return res;
  }
  for (const p of FEEDS) {
    try {
      const r = await get(`https://${host}${p}`, 10000);
      const body = String(r.data || '');
      const isFeed = /<rss|<feed|<urlset|<sitemapindex/i.test(body.slice(0, 3000));
      const isJson = /^\s*[[{]/.test(body) && p.includes('wp-json');
      if (r.status === 200 && (isFeed || isJson)) {
        const items = (body.match(/<item>|<entry|<url>/gi) || []).length;
        res.feeds.push({ path: p, kind: isJson ? 'json' : 'xml', items, bytes: body.length });
      }
    } catch { /* تجاهل */ }
  }
  return res;
}

const out = [];
const CONC = 6;
let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < SITES.length) {
    const h = SITES[i++];
    const r = await probeSite(h);
    out.push(r);
    const mark = r.root === 200 ? (r.feeds.length ? '✅' : '🟡') : '❌';
    const feedTxt = r.feeds.map(f => `${f.path}(${f.kind},${f.items})`).join(' ');
    console.log(`${mark} ${String(r.root).padEnd(6)} ${h.padEnd(24)} ${feedTxt}`);
  }
}));

console.log('\n--- ملخص ---');
console.log('توصل + عندها خلاصة:', out.filter(r => r.root === 200 && r.feeds.length).map(r => r.host).join(', ') || 'لا شيء');
console.log('توصل بلا خلاصة    :', out.filter(r => r.root === 200 && !r.feeds.length).map(r => r.host).join(', '));
console.log('محجوبة/فاشلة      :', out.filter(r => r.root !== 200).map(r => `${r.host}(${r.root})`).join(', '));
