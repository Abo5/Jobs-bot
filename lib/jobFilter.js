// الفلتر المركزي: نافذة زمنية + إزالة تكرار داخل نفس التشغيل + إزالة تكرار عبر التشغيلات.
// نقطة تحكّم واحدة تمرّ منها كل الوظائف من كل المصادر قبل الاختيار والنشر.
import { isWithinWindow } from './dateWindow.js';
import { identityKeys } from './jobIdentity.js';

/**
 * @param {Array} jobs   الوظائف (تحتوي posted_date + رابط + مسمى/شركة)
 * @param {SeenStore} seen  مخزن الوظائف المُعالَجة سابقاً (اختياري)
 * @param {number} nowMs
 * @returns {{ kept: Array, stats: object }}
 */
export function filterJobs(jobs, seen = null, nowMs = Date.now()) {
  const kept = [];
  const runKeys = new Set(); // تكرار ضمن نفس التشغيل
  const stats = { total: jobs.length, stale: 0, dupInRun: 0, dupSeen: 0, kept: 0 };

  for (const job of jobs) {
    // 1) نافذة "اليوم + أمس"
    if (!isWithinWindow(job.posted_date ?? job.posted ?? job.date, nowMs)) { stats.stale++; continue; }

    const keys = identityKeys(job);

    // 2) تكرار داخل التشغيل (نفس الرابط أو نفس بصمة المحتوى)
    if (keys.length && keys.some(k => runKeys.has(k))) { stats.dupInRun++; continue; }

    // 3) تكرار عبر التشغيلات (شوهدت في يوم سابق)
    if (seen && seen.has(job)) { stats.dupSeen++; continue; }

    keys.forEach(k => runKeys.add(k));
    kept.push(job);
  }

  stats.kept = kept.length;
  return { kept, stats };
}
