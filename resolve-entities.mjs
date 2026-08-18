// أداة لمرة واحدة (أو عند إضافة جهة): تحوّل اسم صفحة الشركة على لنكدإن (slug)
// إلى معرّفها الرقمي، لأن الفلترة الدقيقة بالوظائف تتم بـf_C=<id> لا بالاسم.
//
// ليش لا نبحث بالاسم: جرّبناه فكان ضجيجاً — "SDAIA" أرجعت KAUST وAmadeus،
// و"Qiddiya" أرجعت شركات لا علاقة لها. البحث النصي يطابق محتوى الإعلان لا الشركة.
// أما f_C فأرجع وظائف ROSHN وحدها بدقة ١٠٠٪.
//
// الاستخدام:  node resolve-entities.mjs            # يحلّ الناقص في entities.json
//             node resolve-entities.mjs --recheck  # يعيد التحقق من الكل
import axios from 'axios';
import fs from 'fs';

const FILE = 'entities.json';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RECHECK = process.argv.includes('--recheck');

// slug واحد قد لا يكون هو الصحيح، فنجرّب بدائل لكل جهة بالترتيب
async function resolveSlug(slug) {
  const { data, status } = await axios.get(`https://www.linkedin.com/company/${slug}/`, {
    headers: H, timeout: 20000, maxRedirects: 5, validateStatus: () => true
  });
  if (status !== 200) return null;
  const html = String(data);
  const id = html.match(/urn:li:organization:(\d+)/)?.[1] || html.match(/f_C=(\d+)/)?.[1];
  if (!id) return null;
  // الاسم المعروض كما تكتبه الجهة نفسها — نستخدمه للتحقق البشري
  const name = html.match(/<title>([^<|]+)/)?.[1]?.trim() || slug;
  return { id, name };
}

// نتأكد أن المعرّف فعلاً يرجّع وظائف — جهة بلا وظائف منشورة لا تضرّ لكن نوسمها
async function countJobs(id) {
  const { data, status } = await axios.get(
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search',
    { params: { f_C: id, location: 'Saudi Arabia', start: 0 }, headers: H, timeout: 20000, validateStatus: () => true }
  );
  if (status !== 200) return -1;
  return [...String(data).matchAll(/base-search-card__title/g)].length;
}

const entities = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let resolved = 0, failed = 0;

for (const e of entities) {
  if (e.company_id && !RECHECK) continue;
  let hit = null;
  for (const slug of e.slugs) {
    try { hit = await resolveSlug(slug); } catch { hit = null; }
    await sleep(1500);
    if (hit) { e.slug = slug; break; }
  }
  if (!hit) {
    e.company_id = null;
    e.status = 'لم يُعثر على الصفحة';
    console.log(`❌ ${e.name_en}: ما لقينا صفحة من ${e.slugs.join(' / ')}`);
    failed++;
    continue;
  }
  e.company_id = hit.id;
  e.linkedin_name = hit.name;
  const n = await countJobs(hit.id);
  await sleep(1500);
  e.open_jobs = n;
  e.status = n > 0 ? 'يعمل' : 'لا وظائف منشورة حالياً';
  console.log(`✅ ${e.name_en.padEnd(34)} id=${hit.id.padEnd(10)} وظائف=${n === -1 ? '?' : n}  (${hit.name})`);
  resolved++;
}

fs.writeFileSync(FILE, JSON.stringify(entities, null, 2), 'utf8');
console.log(`\nحُلّت ${resolved} | فشلت ${failed} | المجموع ${entities.length}`);
