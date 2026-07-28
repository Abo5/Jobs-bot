// مصادر وظائف عبر APIs جاهزة (بيانات منظمة، بدون حاجة لتحليل AI)
import axios from 'axios';

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json'
};

const RESULTS_PER_SOURCE = Number(process.env.API_RESULTS_PER_SOURCE || 40);
const API_COUNTRY = process.env.API_COUNTRY || 'sa';

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// يشيل كلمات البحث العامة (jobs/in/المدن) عشان يطلع جوهر المسمى الوظيفي
// مثال: "software engineer jobs Saudi Arabia" -> "software engineer"
const STOPWORDS = /\b(jobs?|in|at|for|near|saudi|arabia|ksa|riyadh|jeddah|dammam|khobar|مكة|جدة|الرياض|الدمام|السعودية|وظائف|وظيفة|في)\b/gi;

function coreQuery(keyword) {
  const core = String(keyword).replace(STOPWORDS, ' ').replace(/\s+/g, ' ').trim();
  return core || keyword;
}

function matchesKeyword(text, keyword) {
  const core = coreQuery(keyword).toLowerCase();
  const words = core.split(' ').filter(Boolean);
  if (!words.length) return true;
  const low = String(text || '').toLowerCase();
  return words.every(w => low.includes(w));
}

const job = o => ({
  source: o.source,
  job_url: o.job_url || '',
  job_title: o.job_title || '',
  company: o.company || '',
  location: o.location || '',
  description: stripHtml(o.description).slice(0, 400),
  salary: o.salary || 'غير محدد',
  posted_date: o.posted_date || 'unknown',
  is_remote: !!o.is_remote
});

/* ===== يعمل بدون أي مفتاح ===== */

export async function fetchRemotive(kw) {
  const { data } = await axios.get('https://remotive.com/api/remote-jobs', {
    params: { search: kw, limit: RESULTS_PER_SOURCE }, timeout: 20000, headers: UA
  });
  return (data.jobs || []).map(j => job({
    source: 'remotive', job_url: j.url, job_title: j.title, company: j.company_name,
    location: j.candidate_required_location, description: j.description,
    salary: j.salary, posted_date: j.publication_date, is_remote: true
  }));
}

export async function fetchArbeitnow(kw) {
  const { data } = await axios.get('https://www.arbeitnow.com/api/job-board-api', {
    timeout: 20000, headers: UA
  });
  return (data.data || [])
    .filter(j => matchesKeyword(`${j.title} ${j.tags || ''}`, kw))
    .slice(0, RESULTS_PER_SOURCE)
    .map(j => job({
      source: 'arbeitnow', job_url: j.url, job_title: j.title, company: j.company_name,
      location: j.location, description: j.description,
      posted_date: j.created_at ? new Date(j.created_at * 1000).toISOString() : 'unknown',
      is_remote: !!j.remote
    }));
}

export async function fetchRemoteOK(kw) {
  const { data } = await axios.get('https://remoteok.com/api', { timeout: 20000, headers: UA });
  const rows = Array.isArray(data) ? data.filter(r => r.id) : [];
  return rows
    .filter(j => matchesKeyword(`${j.position} ${(j.tags || []).join(' ')}`, kw))
    .slice(0, RESULTS_PER_SOURCE)
    .map(j => job({
      source: 'remoteok',
      job_url: j.url || `https://remoteok.com/remote-jobs/${j.id}`,
      job_title: j.position, company: j.company, location: j.location || 'Remote',
      description: j.description,
      salary: (j.salary_min && j.salary_max) ? `${j.salary_min}-${j.salary_max}` : 'غير محدد',
      posted_date: j.date, is_remote: true
    }));
}

export async function fetchJobicy(kw) {
  const tag = coreQuery(kw).split(' ')[0] || kw; // Jobicy tag يفضّل كلمة وحدة
  const { data } = await axios.get('https://jobicy.com/api/v2/remote-jobs', {
    params: { count: RESULTS_PER_SOURCE, tag }, timeout: 20000, headers: UA
  });
  return (data.jobs || [])
    .filter(j => matchesKeyword(j.jobTitle, kw))
    .map(j => job({
      source: 'jobicy', job_url: j.url, job_title: j.jobTitle, company: j.companyName,
      location: j.jobGeo || 'Remote', description: j.jobExcerpt,
      salary: j.annualSalaryMin ? `${j.annualSalaryMin}-${j.annualSalaryMax} ${j.salaryCurrency || ''}` : 'غير محدد',
      posted_date: j.pubDate, is_remote: true
    }));
}

export async function fetchHimalayas(kw) {
  const { data } = await axios.get('https://himalayas.app/jobs/api', {
    params: { limit: RESULTS_PER_SOURCE }, timeout: 20000, headers: UA
  });
  return (data.jobs || [])
    .filter(j => matchesKeyword(j.title, kw))
    .slice(0, RESULTS_PER_SOURCE)
    .map(j => job({
      source: 'himalayas', job_url: j.applicationLink || j.guid, job_title: j.title,
      company: j.companyName, location: (j.locationRestrictions || []).join(', ') || 'Remote',
      description: j.excerpt || j.description,
      posted_date: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : 'unknown', is_remote: true
    }));
}

export async function fetchTheMuse(kw) {
  const { data } = await axios.get('https://www.themuse.com/api/public/jobs', {
    params: { page: 1 }, timeout: 20000, headers: UA
  });
  return (data.results || [])
    .filter(j => matchesKeyword(j.name, kw))
    .slice(0, RESULTS_PER_SOURCE)
    .map(j => job({
      source: 'themuse', job_url: j.refs?.landing_page, job_title: j.name,
      company: j.company?.name, location: (j.locations || []).map(l => l.name).join(', '),
      description: j.contents, posted_date: j.publication_date
    }));
}

/* ===== تحتاج مفتاح مجاني (تتفعل تلقائياً عند إضافته في .env) ===== */

export async function fetchAdzuna(kw) {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY) return [];
  const country = (process.env.ADZUNA_COUNTRY || 'gb').toLowerCase();
  const { data } = await axios.get(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`, {
    params: {
      app_id: process.env.ADZUNA_APP_ID, app_key: process.env.ADZUNA_APP_KEY,
      what: kw, results_per_page: RESULTS_PER_SOURCE, 'content-type': 'application/json'
    }, timeout: 20000, headers: UA
  });
  return (data.results || []).map(j => job({
    source: 'adzuna', job_url: j.redirect_url, job_title: j.title,
    company: j.company?.display_name, location: j.location?.display_name,
    description: j.description, salary: j.salary_min ? `${j.salary_min}-${j.salary_max}` : 'غير محدد',
    posted_date: j.created
  }));
}

export async function fetchJooble(kw) {
  if (!process.env.JOOBLE_KEY) return [];
  const { data } = await axios.post(
    `https://jooble.org/api/${process.env.JOOBLE_KEY}`,
    { keywords: kw, location: API_COUNTRY },
    { timeout: 20000, headers: { 'Content-Type': 'application/json' } }
  );
  return (data.jobs || []).slice(0, RESULTS_PER_SOURCE).map(j => job({
    source: 'jooble', job_url: j.link, job_title: j.title, company: j.company,
    location: j.location, description: j.snippet, salary: j.salary, posted_date: j.updated
  }));
}

export async function fetchFindwork(kw) {
  if (!process.env.FINDWORK_KEY) return [];
  const { data } = await axios.get('https://findwork.dev/api/jobs/', {
    params: { search: kw }, timeout: 20000,
    headers: { ...UA, Authorization: `Token ${process.env.FINDWORK_KEY}` }
  });
  return (data.results || []).slice(0, RESULTS_PER_SOURCE).map(j => job({
    source: 'findwork', job_url: j.url, job_title: j.role, company: j.company_name,
    location: j.location || (j.remote ? 'Remote' : ''), description: j.text,
    posted_date: j.date_posted, is_remote: !!j.remote
  }));
}

export async function fetchCareerjet(kw) {
  if (!process.env.CAREERJET_AFFID) return [];
  const { data } = await axios.get('http://public.api.careerjet.net/search', {
    params: {
      keywords: kw, location: 'Saudi Arabia', affid: process.env.CAREERJET_AFFID,
      pagesize: RESULTS_PER_SOURCE, user_ip: '11.22.33.44',
      user_agent: UA['User-Agent'], url: 'https://www.careerjet.com'
    }, timeout: 20000, headers: UA
  });
  return (data.jobs || []).map(j => job({
    source: 'careerjet', job_url: j.url, job_title: j.title, company: j.company,
    location: j.locations, description: j.description, salary: j.salary, posted_date: j.date
  }));
}

export async function fetchJSearch(kw) {
  if (!process.env.JSEARCH_RAPIDAPI_KEY) return [];
  const { data } = await axios.get('https://jsearch.p.rapidapi.com/search', {
    params: { query: `${kw} in ${API_COUNTRY}`, page: '1', num_pages: '1' }, timeout: 20000,
    headers: {
      'X-RapidAPI-Key': process.env.JSEARCH_RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
    }
  });
  return (data.data || []).slice(0, RESULTS_PER_SOURCE).map(j => job({
    source: 'jsearch', job_url: j.job_apply_link || j.job_google_link, job_title: j.job_title,
    company: j.employer_name, location: [j.job_city, j.job_country].filter(Boolean).join(', '),
    description: j.job_description,
    salary: j.job_min_salary ? `${j.job_min_salary}-${j.job_max_salary}` : 'غير محدد',
    posted_date: j.job_posted_at_datetime_utc, is_remote: !!j.job_is_remote
  }));
}

// مصادر عالمية/عن بعد — نادراً ما تحوي وظائف سعودية فعلية (أغلبها أمريكا/أوروبا).
// معطّلة افتراضياً (ENABLE_GLOBAL_REMOTE_APIS=false) عشان ما تهدر استدعاءات AI
// على نتائج بتتفلتر لاحقاً على أي حال. فعّلها فقط لو تبي تنويع عالمي إضافي.
export const GLOBAL_REMOTE_SOURCES = [
  { name: 'remotive', needsKey: false, fn: fetchRemotive },
  { name: 'arbeitnow', needsKey: false, fn: fetchArbeitnow },
  { name: 'remoteok', needsKey: false, fn: fetchRemoteOK },
  { name: 'jobicy', needsKey: false, fn: fetchJobicy },
  { name: 'himalayas', needsKey: false, fn: fetchHimalayas },
  { name: 'themuse', needsKey: false, fn: fetchTheMuse }
];

// مصادر عندها فرصة حقيقية تغطّي السعودية (تحتاج مفتاح مجاني تسجّله بنفسك).
// ملاحظة: Adzuna لا يدعم السعودية ضمن قائمة دوله حالياً حتى لو حطّيت مفتاح —
// خليتها موجودة لو تغيّر ذلك مستقبلاً. Careerjet عنده نطاق سعودي مخصّص
// (careerjet.com.sa) وهو الأفضل من هالمجموعة.
export const KEY_GATED_SOURCES = [
  { name: 'adzuna', needsKey: true, fn: fetchAdzuna },
  { name: 'jooble', needsKey: true, fn: fetchJooble },
  { name: 'findwork', needsKey: true, fn: fetchFindwork },
  { name: 'careerjet', needsKey: true, fn: fetchCareerjet },
  { name: 'jsearch', needsKey: true, fn: fetchJSearch }
];

// كل مصدر: { name, needsKey, fn }
export const API_SOURCES = [...GLOBAL_REMOTE_SOURCES, ...KEY_GATED_SOURCES];
