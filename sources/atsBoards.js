// مصدر لوحات التوظيف (ATS) للشركات اللي تعمل في السعودية.
//
// ليش هذا المصدر: كل منصّات ATS الكبيرة تنشر وظائف كل شركة على واجهة JSON
// عامة وموثّقة، بلا مفتاح وبلا تسجيل دخول. وأهم من ذلك — ما تمرّ عبر
// Cloudflare حق مواقع الوظائف، فما تتأثر بالحجب اللي يضرب
// bayt / indeed / gulftalent / mihnati (كلها 403 من هذا الجهاز).
//
// أنماط الواجهات (<slug> = اسم الشركة على المنصّة):
//   greenhouse       boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
//   lever            api.lever.co/v0/postings/<slug>?mode=json
//   ashby            api.ashbyhq.com/posting-api/job-board/<slug>
//   workable         apply.workable.com/api/v1/widget/accounts/<slug>?details=true
//   recruitee        <slug>.recruitee.com/api/offers/
//   smartrecruiters  api.smartrecruiters.com/v1/companies/<slug>/postings
//   teamtailor       <slug>.teamtailor.com/jobs.json
//
// مهم: HTTP 200 لا يعني إن الشركة موجودة. Greenhouse يرجّع 404 للاسم المجهول،
// لكن SmartRecruiters يرجّع 200 مع totalFound=0، وAshby يرجّع 200 مع jobs=[].
// لذلك الاعتماد على رمز الحالة يولّد مصادر وهمية — نتحقق من طول المصفوفة.
//
// الشركات في COMPANIES تحققنا منها فعلياً (عندها وظائف سعودية وقت الإضافة).
// لإضافة شركة: شغّل discover_ats.mjs بعد ما تضيف اسمها في قائمة SLUGS هناك.
//
// الرد يُمرَّر مباشرة لمسار apiJobs (نفس شكل مصادر apiSources) — بدون استخراج AI.
import axios from 'axios';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json'
};

const TIMEOUT = Number(process.env.ATS_TIMEOUT_MS || 15000);
const MAX_PER_COMPANY = Number(process.env.ATS_MAX_PER_COMPANY || 60);

// شركات متحقَّق منها: [المنصّة, الاسم, الاسم المعروض]
const COMPANIES = [
  ['workable', 'salla', 'سلة'],
  ['workable', 'foodics', 'فودكس'],
  ['greenhouse', 'tamara', 'تمارا'],
  ['greenhouse', 'lucidmotors', 'Lucid Motors'],
  ['recruitee', 'unifonic', 'يونيفونك'],
  ['recruitee', 'moneyhash', 'MoneyHash'],
  ['smartrecruiters', 'deliveryhero', 'Delivery Hero'],
];

const stripHtml = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

const job = o => ({
  source: o.source,
  job_url: o.job_url || '',
  job_title: o.job_title || '',
  company: o.company || '',
  location: o.location || '',
  description: stripHtml(o.description).slice(0, 400),
  salary: 'غير محدد',
  posted_date: o.posted_date || 'unknown',
  is_remote: /remote|عن بعد/i.test(`${o.job_title} ${o.location}`)
});

// كل مُهيّئ يرجّع: { url, pick(data) -> صفوف موحّدة }
const ADAPTERS = {
  greenhouse: {
    url: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`,
    pick: d => (d?.jobs || []).map(j => ({
      job_url: j.absolute_url, job_title: j.title,
      location: j.location?.name || '', description: j.content || '',
      posted_date: j.updated_at || j.first_published || 'unknown'
    }))
  },
  lever: {
    url: s => `https://api.lever.co/v0/postings/${s}?mode=json`,
    pick: d => (Array.isArray(d) ? d : []).map(j => ({
      job_url: j.hostedUrl || j.applyUrl, job_title: j.text,
      location: j.categories?.location || '', description: j.descriptionPlain || j.description || '',
      posted_date: j.createdAt ? new Date(j.createdAt).toISOString() : 'unknown'
    }))
  },
  ashby: {
    url: s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    pick: d => (d?.jobs || []).map(j => ({
      job_url: j.jobUrl || j.applyUrl, job_title: j.title,
      location: j.location || '', description: j.descriptionPlain || '',
      posted_date: j.publishedAt || 'unknown'
    }))
  },
  workable: {
    url: s => `https://apply.workable.com/api/v1/widget/accounts/${s}?details=true`,
    pick: d => (d?.jobs || []).map(j => ({
      job_url: j.url || j.shortlink, job_title: j.title,
      location: [j.city, j.country].filter(Boolean).join(', '),
      description: j.description || j.requirements || '',
      posted_date: j.published_on || j.created_at || 'unknown'
    }))
  },
  recruitee: {
    url: s => `https://${s}.recruitee.com/api/offers/`,
    pick: d => (d?.offers || []).map(j => ({
      job_url: j.careers_url || j.careers_apply_url, job_title: j.title,
      location: [j.city, j.country].filter(Boolean).join(', '),
      description: j.description || j.requirements || '',
      posted_date: j.published_at || j.created_at || 'unknown'
    }))
  },
  smartrecruiters: {
    url: s => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`,
    pick: d => (d?.content || []).map(j => ({
      job_url: j.ref ? `https://jobs.smartrecruiters.com/${j.company?.identifier || ''}/${j.id}` : '',
      job_title: j.name,
      location: [j.location?.city, j.location?.country].filter(Boolean).join(', '),
      description: j.jobAd?.sections?.jobDescription?.text || '',
      posted_date: j.releasedDate || 'unknown'
    }))
  },
  teamtailor: {
    url: s => `https://${s}.teamtailor.com/jobs.json`,
    pick: d => (d?.jobs || []).map(j => ({
      job_url: j.careersite_job_url || j.url, job_title: j.title,
      location: j.locality || '', description: j.body || '',
      posted_date: j.created_at || 'unknown'
    }))
  }
};

async function fetchCompany(platform, slug, label) {
  const ad = ADAPTERS[platform];
  if (!ad) return [];
  const { data } = await axios.get(ad.url(slug), { timeout: TIMEOUT, headers: HEADERS });
  const rows = ad.pick(data);
  return rows
    .filter(r => r.job_title && r.job_url)
    .slice(0, MAX_PER_COMPANY)
    .map(r => job({ ...r, source: `ats:${platform}`, company: label || slug }));
}

export async function fetchAtsBoards() {
  const out = [];
  // تسلسلي: ٧ طلبات فقط، وما نبي نستفز أي منصّة بضربات متوازية.
  for (const [platform, slug, label] of COMPANIES) {
    try {
      const rows = await fetchCompany(platform, slug, label);
      if (rows.length) {
        out.push(...rows);
        console.log(`   ✓ [ats:${platform}] ${label} -> ${rows.length}`);
      } else {
        console.log(`   · [ats:${platform}] ${label} -> 0 (اللوحة فاضية أو الاسم تغيّر)`);
      }
    } catch (e) {
      const code = e.response?.status ? `HTTP ${e.response.status}` : e.message;
      console.warn(`   ⚠️ [ats:${platform}] ${label} فشل: ${code}`);
    }
  }
  console.log(`   ✓ [ats] جمعنا ${out.length} وظيفة من ${COMPANIES.length} لوحة`);
  return out;
}
