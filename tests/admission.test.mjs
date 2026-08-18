// اختبارات كاشف فتح القبول/التسجيل والتصنيف الحتمي (2026-08-18)
import { isAdmissionTitle, isAdmissionAnnouncement, categoryForJob } from '../lib/sectors.js';
import { fallbackDescriptionFor } from '../lib/importantFallback.js';

let pass = 0, fail = 0;
function t(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.log(`❌ ${name}: توقّعنا ${want} وجدنا ${got}`); }
}

// ===== طبقة ١: المسمّى الصريح (أي مصدر) =====
const POS = [
  'فتح باب القبول والتسجيل', 'بدء التسجيل للعام الجامعي', 'إعلان فتح باب التقديم',
  'استقبال طلبات التوظيف', 'بوابة القبول الموحد', 'التسجيل مفتوح',
  'برنامج بكالوريوس', 'برنامج دبلوم', 'برنامج تجسير', 'بكالوريوس تجسير',
  'دبلوم عالي', 'منح دراسية', 'منحة ابتعاث', 'ابتعاث خارجي', 'برنامج تمهير',
  'وظائف عسكرية', 'وظائف مدنية', 'التجنيد', 'رتب عسكرية', 'القوات المسلحة',
  'كلية الملك فهد البحرية', 'وزارة الدفاع — فتح باب القبول', 'حملة التوظيف',
  'Admissions Open 2026', 'Enrollment Now Open', 'Hiring Campaign',
  'Bridging Program', 'Diploma Program', 'Military Recruitment', 'Tamheer'
];
for (const s of POS) t(`إيجابي: ${s}`, isAdmissionTitle(s), true);

const NEG = [
  'QA Engineer', 'مهندس اختبار برمجيات', 'DevOps Engineer', 'Cloud Architect',
  'Security Analyst', 'مهندس مدني', 'حارس أمن', 'Security Guard',
  'مطلوب حملة البكالوريوس', 'بكالوريوس علوم حاسب', 'معلم لغة عربية',
  'أستاذ مساعد — كلية الهندسة', 'موظف استقبال', 'مشرف إنتاج'
];
for (const s of NEG) t(`سلبي: ${s}`, isAdmissionTitle(s), false);

// ===== طبقة ٢: عبارة الإعلان الرسمية (الجهات المُراقَبة فقط) =====
t('إعلان: يعلن عن فتح باب التسجيل', isAdmissionAnnouncement('برنامج تطويري', '', 'يعلن المركز عن فتح باب التسجيل'), true);
t('إعلان: تعلن بدء التقديم', isAdmissionAnnouncement('فرصة', '', 'تعلن الجهة عن بدء التقديم'), true);
t('إعلان: القبول والتسجيل مفتوح', isAdmissionAnnouncement('', '', 'القبول والتسجيل مفتوح الآن'), true);
t('إعلان إنجليزي: applications are now open', isAdmissionAnnouncement('Program', '', 'Applications are now open for the program'), true);
t('سلبي: وصف وظيفة عادي', isAdmissionAnnouncement('محلل', '', 'إعداد التقارير الدورية ومتابعة الأداء'), false);

// ===== التصنيف الحتمي categoryForJob =====
t('تقني: أمن سيبراني', categoryForJob({ job_title: 'Security Engineer' }).label, 'الأمن السيبراني');
t('تقني: DevOps', categoryForJob({ job_title: 'DevOps Engineer' }).label, 'DevOps');
t('تقني: سحابة', categoryForJob({ job_title: 'Cloud Architect' }).label, 'السحابة');
t('تقني: ضمان جودة', categoryForJob({ job_title: 'QA Engineer', company: 'شركة تقنية', description: 'اختبار تطبيقات ويب' }).label, 'ضمان الجودة');
t('حكومية', categoryForJob({ is_government: true }).label, 'وظيفة حكومية');
t('قبول وتسجيل مع جهة', categoryForJob({ is_admission: true, entity: 'NHC' }).label, 'فتح قبول وتسجيل — NHC');
t('برنامج جهة', categoryForJob({ is_program: true, entity: 'NEOM' }).label, 'برنامج توظيف/تدريب — NEOM');
t('إيموجي حكومية', categoryForJob({ is_government: true }).emoji, '🏛️');

// ===== قوالب الوصف الاحتياطية =====
for (const j of [
  { job_title: 'QA Engineer', company: 'x' },
  { job_title: 'DevOps Engineer', company: 'x' },
  { job_title: 'Cloud Engineer', company: 'x' },
  { job_title: 'Security Analyst', company: 'x' },
  { is_government: true },
  { is_admission: true, entity: 'جهة' },
  { is_program: true, entity: 'جهة' }
]) {
  const d = fallbackDescriptionFor(j);
  t(`قالب ${categoryForJob(j).label}: نص عربي غير فارغ`, Boolean(d && d.length > 20 && /[\u0600-\u06FF]/.test(d)), true);
}

console.log(`\n${fail === 0 ? '🏁 كل الاختبارات نجحت' : '⛔ فشل'} — نجح ${pass} | فشل ${fail}`);
process.exit(fail === 0 ? 0 : 1);
