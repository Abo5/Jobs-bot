// بوابة الذكاء الاصطناعي النهائية: تتأكد إن كل وظيفة نجت من فلتر الـregex
// هي فعلاً QA/QC برمجيات (اختبار نظام أو موقع/تطبيق) — لا جودة إنشاءات ولا مصانع
// ولا فحص ميداني ولا جودة مؤسسية (ISO/QMS).
//
// ليش نحتاجها فوق الـregex: الـregex ما يفهم النية. "QA Engineer" في شركة مقاولات
// بوصف عام تعدّي regex لو ذُكرت كلمة تقنية عابرة؛ الـAI يقرأ الإعلان ككل ويحكم.
//
// دفعات لا وظيفة-وظيفة: حد معدل NVIDIA ~8.5 طلب/دقيقة (شوف lib/ai.js)، فطلب لكل
// وظيفة يفجّر الحد ويوقف استدعاء "أهم الوظائف" اللي يحدد وش يُنشر.
//
// سياسة الفشل: لو فشل الاستدعاء (429/انقطاع) نُبقي نتيجة الـregex كما هي بدل ما
// نرمي التشغيلة كاملة — الـregex أصلاً صارم، والخسارة الأسوأ هي عدم النشر إطلاقاً.

import { callAI, safeJsonParse } from './ai.js';

const BATCH_SIZE = Number(process.env.QA_CLASSIFY_BATCH || 25);

const QA_CLASSIFY_PROMPT = `
You are a strict job classifier. A job is ACCEPTED only if it belongs to one of
these four technology domains:

  1. SOFTWARE QA / QC — quality assurance, quality control, or testing performed
     on software: web apps, websites, mobile apps, APIs, backend systems, or
     digital platforms. (QA Engineer, SDET, Software Tester, Test Automation.)

  2. DEVOPS / SRE / PLATFORM — DevOps, DevSecOps, Site Reliability, Platform or
     Infrastructure engineering, CI/CD, build & release, Kubernetes, Docker,
     Terraform, Ansible, GitOps, observability.

  3. CLOUD — cloud engineering, architecture, administration or consulting on
     AWS, Azure, GCP, OpenStack/OpenShift; cloud-native and cloud migration.

  4. CYBER SECURITY (all branches, offensive and defensive) — security
     engineering/analysis/architecture, SOC, penetration testing, red/blue/purple
     team, ethical hacking, vulnerability management, threat hunting and
     intelligence, incident response, DFIR, malware analysis, reverse
     engineering, application/product/cloud security, IAM, SIEM/SOAR, and
     security governance/compliance (ISO 27001, NCA, PCI DSS).

REJECT everything else, including:
- Civil / construction / structural QA-QC, site inspectors, welding or NDT inspection
- Manufacturing, factory, production-line, refinery, oil & gas, or petrochemical quality
- Food, pharmaceutical, chemical, medical, or physical laboratory quality
- HSE / safety, calibration, metrology, surveying
- ISO 9001 / QMS / corporate quality-management or auditing roles that are not software
- PHYSICAL security: security guards/officers, patrols, CCTV operators, loss
  prevention, fire or occupational safety. "Security" alone is NOT enough — the
  role must be about information/cyber security.
- Pure software development, data, AI/ML, PR, media, sales, finance or any role
  outside the four domains above

IMPORTANT: the employer's industry does NOT disqualify a job. A cyber-security
engineer, DevOps engineer or cloud architect at an oil, construction or
manufacturing company IS accepted — judge the ROLE, not the company.

If the posting is ambiguous and you cannot confirm it belongs to one of the four
domains, REJECT it. Precision matters far more than recall.

Return STRICTLY this JSON, no markdown, no commentary:
{"software_qa_ids": [<id of every ACCEPTED job>]}
`;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toClassifierInput(j, id) {
  return {
    id,
    title: j.job_title || '',
    title_ar: j.job_title_ar || '',
    company: j.company || '',
    sector: j.sector || '',
    description: String(j.description || j.description_ar || '').slice(0, 400),
    requirements: (Array.isArray(j.requirements) ? j.requirements : []).slice(0, 5)
  };
}

/**
 * ترجّع الوظائف اللي أكّد الـAI إنها QA برمجيات.
 * jobs: مصفوفة الوظائف المحلَّلة. ترجّع { kept, dropped, aiFailed }.
 */
export async function verifySoftwareQa(jobs) {
  if (!jobs.length) return { kept: [], dropped: [], aiFailed: false };

  const kept = [];
  const dropped = [];
  let aiFailed = false;

  for (const batch of chunk(jobs, BATCH_SIZE)) {
    // معرّف محلي للدفعة — ما نعتمد على job_id لأنه قد يكون مفقود أو مكرر عبر المصادر
    const indexed = batch.map((j, i) => ({ job: j, input: toClassifierInput(j, i + 1) }));

    let acceptedIds;
    try {
      const raw = await callAI({
        system: QA_CLASSIFY_PROMPT,
        user: JSON.stringify({ jobs: indexed.map(x => x.input) }).slice(0, 28000),
        expectJson: true
      });
      const parsed = safeJsonParse(raw);
      const ids = Array.isArray(parsed.software_qa_ids) ? parsed.software_qa_ids : [];
      acceptedIds = new Set(ids.map(Number).filter(Number.isFinite));
    } catch (e) {
      console.warn(`⚠️ بوابة AI للجودة فشلت لدفعة (${batch.length} وظيفة): ${e.message} — نُبقي نتيجة الفلتر النصي`);
      aiFailed = true;
      kept.push(...batch);
      continue;
    }

    for (const { job, input } of indexed) {
      if (acceptedIds.has(input.id)) kept.push(job);
      else dropped.push(job);
    }
  }

  return { kept, dropped, aiFailed };
}
