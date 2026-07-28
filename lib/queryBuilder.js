// يبني استعلامات بحث "ذكية" بدمج المسمى الوظيفي مع مدن سعودية فعلية
// بدل الاكتفاء بـ "Saudi Arabia" عامة — مثال: "node js developer Riyadh"،
// "node js developer Jeddah"... يزيد فرصة الوصول لإعلانات محلية دقيقة.

const CITIES_EN = ['Riyadh', 'Jeddah', 'Dammam', 'Khobar', 'Mecca', 'Medina', 'Taif', 'Abha', 'Jubail', 'Yanbu'];
const CITIES_AR = ['الرياض', 'جدة', 'الدمام', 'الخبر', 'مكة', 'المدينة المنورة', 'الطائف', 'أبها', 'الجبيل', 'ينبع'];

function isArabic(s) {
  return /[؀-ۿ]/.test(s);
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

/**
 * roles: قائمة مسميات/كلمات مفتاحية أساسية (من keywords.json)
 * citiesPerRole: كم مدينة نجرّب لكل مسمى (عيّنة عشوائية، مو كل المدن، لتفادي انفجار عدد الاستعلامات)
 * alwaysBroad: نضيف مع كل مسمى نسخة عامة بدون مدينة (تغطية احتياطية)
 */
export function buildSmartQueries(roles, { citiesPerRole = 2, alwaysBroad = true } = {}) {
  const out = new Set();

  for (const role of roles) {
    const arabic = isArabic(role);
    const cities = shuffle(arabic ? CITIES_AR : CITIES_EN).slice(0, citiesPerRole);

    for (const city of cities) {
      out.add(arabic ? `${role} ${city}` : `${role} ${city} Saudi Arabia`);
    }

    if (alwaysBroad) {
      out.add(arabic ? role : `${role} Saudi Arabia`);
    }
  }

  return [...out];
}
