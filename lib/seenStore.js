// مخزن دائم للوظائف المُعالَجة سابقاً — يمنع تكرار الجلب/النشر عبر التشغيلات.
// يخزّن كل مفاتيح الهوية (رابط + بصمة محتوى) مع تاريخ آخر ظهور، ويُقلَّم دورياً.
//
// السيناريو: وظيفة ظهرت أمس وعولجت -> تُسجَّل هنا. تشغيل اليوم يلقاها بنفس
// الرابط أو نفس (المسمى+الشركة+المدينة) فيتخطّاها ولو جت من مصدر مختلف.
import fs from 'fs';
import { identityKeys } from './jobIdentity.js';

const STORE_FILE = process.env.SEEN_STORE_FILE || 'seen-jobs.json';
// نحتفظ بأثر أطول من النافذة بقليل حتى ما يعود المكرر بعد خروجه من النافذة الزمنية
const RETENTION_DAYS = Number(process.env.SEEN_RETENTION_DAYS || 14);

export class SeenStore {
  constructor(file = STORE_FILE) {
    this.file = file;
    this.map = new Map(); // key -> ISO string (آخر ظهور)
    this._load();
  }

  _load() {
    try {
      const obj = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(obj || {})) this.map.set(k, v);
    } catch { /* أول تشغيل: لا ملف */ }
    this._prune();
  }

  _prune() {
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    for (const [k, iso] of this.map) {
      const t = Date.parse(iso);
      if (!Number.isFinite(t) || t < cutoff) this.map.delete(k);
    }
  }

  // هل شوهدت هذه الوظيفة في تشغيل سابق؟ (تطابق أي مفتاح هوية)
  has(job) {
    return identityKeys(job).some(k => this.map.has(k));
  }

  // سجّل الوظيفة كمُعالَجة الآن (كل مفاتيحها)
  add(job, iso = new Date().toISOString()) {
    for (const k of identityKeys(job)) this.map.set(k, iso);
  }

  save() {
    this._prune();
    const obj = Object.fromEntries(this.map);
    fs.writeFileSync(this.file, JSON.stringify(obj), 'utf8');
  }

  get size() { return this.map.size; }
}
