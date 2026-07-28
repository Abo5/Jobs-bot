// فلترة: يبقي بس الوظائف اللي موقعها فعلياً داخل السعودية (كل المناطق)
const SAUDI_PATTERN = new RegExp(
  [
    // إنجليزي
    'saudi', 'ksa', 'riyadh', 'jeddah', 'jiddah', 'dammam', 'khobar', 'al.?khobar',
    'dhahran', 'jubail', 'yanbu', 'taif', 'ta.if', 'abha', 'tabuk', 'hail', 'ha.il',
    'jazan', 'jizan', 'najran', 'qassim', 'qaseem', 'buraidah', 'buraydah', 'medina',
    'madinah', 'mecca', 'makkah', 'al.?ahsa', 'hofuf', 'kharj', 'qatif', 'sakaka',
    'arar', 'baha', 'najran',
    // عربي
    'السعودية', 'المملكة العربية السعودية', 'الرياض', 'جدة', 'جده', 'الدمام',
    'الخبر', 'الظهران', 'الجبيل', 'ينبع', 'الطائف', 'أبها', 'ابها', 'تبوك',
    'حائل', 'جازان', 'نجران', 'القصيم', 'بريدة', 'المدينة المنورة', 'مكة المكرمة',
    'مكة', 'الأحساء', 'الاحساء', 'الهفوف', 'الخرج', 'القطيف', 'سكاكا', 'عرعر', 'الباحة'
  ].join('|'),
  'i'
);

export function isSaudiLocation(text) {
  return SAUDI_PATTERN.test(String(text || ''));
}
