// تصنيف: حكومي (أي مجال يعدي) مقابل قطاع خاص
// (لازم يكون تقنية / QA-QC / ذكاء اصطناعي / أمن سيبراني / علاقات عامة / إذاعة وتلفزيون / إعلام)
// ملاحظة: التسويق أُزيل من المجالات المستهدفة بطلب المالك (2026-07-26).

// ملاحظة مهمة (أُصلحت 2026-07-26): هذا النمط يُطبَّق على وصف الوظيفة الحر، وأي
// كلمة عامة فيه تُصنّف الوظيفة "حكومية" فتتجاوز فلتر القطاعات بالكامل. كانت
// 'محافظة' و'المرور' و'أمانة' تمرّر وظائف مثل "سائق دباب" و"مهندس ميكانيكا"
// لأنها ألفاظ شائعة (اسم مكان / المرور بالطريق / الأمانة كصفة شخصية).
// القاعدة الآن: أي مدخل هنا لازم يكون صيغة اسم جهة، مو كلمة مفردة عامة.
const GOVERNMENT_PATTERN = new RegExp(
  [
    // عربي
    'وزارة', 'هيئة عامة', 'الهيئة العامة', 'بلدية', 'جامعة الملك',
    'أمانة (منطقة|محافظة|مدينة|العاصمة)', 'امانة (منطقة|محافظة|مدينة|العاصمة)',
    'جامعة الأميرة', 'جامعة الإمام', 'جامعة أم القرى', 'إمارة منطقة', 'امارة منطقة',
    'ديوان المظالم', 'الديوان الملكي', 'وزارة الدفاع', 'القوات المسلحة',
    'الحرس الوطني', 'وزارة الداخلية', 'وزارة الصحة', 'مدينة الملك عبدالعزيز',
    'مدينة الملك عبدالله', 'صندوق التنمية', 'المؤسسة العامة', 'مصلحة الجمارك',
    '(الإدارة|الادارة|المديرية) العامة (للجوازات|للمرور|للدفاع المدني|للسجون)',
    '(مديرية|إدارة) (الجوازات|المرور|الدفاع المدني)',
    'هيئة الطيران', 'هيئة الاتصالات',
    'هيئة السوق المالية', 'ساما', 'مؤسسة النقد', 'البنك المركزي السعودي',
    'مجلس الشورى', 'رئاسة أمن الدولة', 'مستشفى حكومي', 'مركز صحي حكومي',
    'وكالة الأنباء السعودية', 'واس\\b', 'الهلال الأحمر', 'حرس الحدود',
    // إنجليزي
    'ministry of', 'general authority', 'royal commission', 'municipality',
    'saudi armed forces', 'national guard', 'ministry\\b', 'government of saudi',
    'civil defense', 'public prosecution', 'council of ministers', 'sasp\\b',
    'king abdulaziz city', 'king salman', 'sama\\b', 'central bank of saudi'
  ].join('|'),
  'i'
);

const TARGET_PRIVATE_PATTERN = new RegExp(
  [
    // تقنية — ملاحظة: تعمّدنا ما نحط كلمة "engineer" مجرّدة لأنها تطابق أي مهندس
    // (مدني/كهربائي/زراعي...)، خليناها دايم مقيّدة بكلمة تقنية قبلها
    'software', 'developer', 'programmer', '\\bit\\b', 'information technology',
    '(software|network|data|security|cyber|systems?|cloud|devops|platform|reliability|qa|ml|ai|automation) engineer',
    'tech\\b', 'technical support', 'backend', 'frontend', 'full.?stack', 'devops', 'cloud computing',
    'network (admin|engineer)', 'database (admin|engineer)', 'data (scientist|analyst|engineer)',
    'mobile (app|developer)', 'ux\\b', 'ui\\b',
    'برمج', 'مطور', 'مبرمج', 'مهندس (برمجيات|شبكات|حاسب|تقنية|أنظمة)', 'تقنية المعلومات',
    // ملاحظة: كلمة 'تقني' المجرّدة أُزيلت (2026-07-26) — كانت تطابق "أحدث التقنيات"
    // في إعلانات غير تقنية فتمرّر وظائف مثل "طبيب أسنان".
    '(أخصائي|اخصائي|مسؤول|مدير|فني|فنى) تقني', 'الدعم التقني', 'دعم تقني',
    'شبكات', 'قواعد بيانات', 'محلل بيانات', 'عالم بيانات', 'دعم فني',

    // ذكاء اصطناعي وتعلّم آلة
    'machine learning', '\\bai\\b', 'artificial intelligence', '\\bml\\b', 'deep learning',
    '\\bnlp\\b', 'computer vision', 'generative ai', '\\bllm\\b', 'data scientist', 'mlops',
    'ذكاء اصطناعي', 'الذكاء الاصطناعي', 'تعلم آلي', 'التعلم الآلي', 'تعلّم عميق', 'نماذج لغوية',

    // أمن سيبراني
    'cyber ?security', 'information security', 'infosec\\b', '\\bsoc\\b analyst', 'penetration test',
    'pentest', 'ethical hack', 'vulnerability (analyst|management)', 'incident response',
    'security operations', 'threat (intel|hunting)', '\\bgrc\\b', '\\bsiem\\b',
    'أمن سيبراني', 'الأمن السيبراني', 'أمن معلومات', 'أمن المعلومات', 'اختبار اختراق', 'حوكمة أمن',

    // ضمان/ضبط الجودة والاختبار وأجايل
    '\\bqa\\b', '\\bqc\\b', 'qa ?/ ?qc', 'qa engineer', 'quality assurance', 'quality control',
    'tester\\b', 'test engineer', 'test automation', '\\bsdet\\b', 'quality engineer',
    'quality inspector', 'quality specialist', '\\bagile\\b', '\\bscrum\\b', 'scrum master', 'kanban',
    // "ال" اختيارية: "مهندس ضبط جودة" و"مهندس ضبط الجودة" لازم يعديان الاثنين
    'ضمان (ال)?جودة', 'ضبط (ال)?جودة', 'مراقبة (ال)?جودة', 'التحكم (بالجودة|في الجودة)',
    'مفتش (ال)?جودة', 'مراقب (ال)?جودة', '(أخصائي|اخصائي) (ال)?جودة', 'تدقيق (ال)?جودة',
    'مختبر برمجيات', 'اختبار برمجيات', 'محلل جودة', 'مهندس جودة', 'أجايل', 'سكرم',

    // علاقات عامة
    'public relations', '\\bpr\\b', 'communications (specialist|manager|officer)',
    'علاقات عامة', 'العلاقات العامة', 'اتصال مؤسسي', 'التواصل المؤسسي',

    // إذاعة وتلفزيون
    'broadcast', 'broadcasting', 'radio\\b', 'television', '\\btv\\b', 'anchor\\b',
    'إذاعة', 'تلفزيون', 'راديو', 'قناة فضائية', 'محطة إذاعية', 'مذيع', 'مقدم برامج',

    // إعلام — "social media" مستثناة لأنها دور تسويقي، والتسويق خارج النطاق
    '(?<!social )media\\b', 'journalist', 'journalism', 'editor\\b', 'newsroom', 'content creator',
    'content writer', 'copywriter', 'reporter\\b',
    // 'صحافة' مقيّدة: "الصحافة الكهربائية/الهيدروليكية" = مكبس صناعي، مو صحافة إعلامية
    'إعلام', 'إعلامي', 'صحافة(?!\\s*(ال)?(كهربائية|هيدروليكية|ميكانيكية|يدوية))',
    'صحفي', 'محرر', 'مراسل', 'منتج إعلامي', 'صانع محتوى', 'كاتب محتوى'
  ].join('|'),
  'i'
);

export function isGovernmentJob(...fields) {
  return GOVERNMENT_PATTERN.test(fields.filter(Boolean).join(' '));
}

export function isTargetPrivateSector(...fields) {
  return TARGET_PRIVATE_PATTERN.test(fields.filter(Boolean).join(' '));
}

// القاعدة النهائية: حكومي = يعدي أي مجال. قطاع خاص = لازم يطابق المجالات المستهدفة.
//
// المسمّى الوظيفي هو المرجع لتصنيف القطاع الخاص (أُصلح 2026-07-26): مطابقة الوصف
// الحر كانت تمرّر وظائف خارج النطاق لأن أي مهمة عابرة تُذكر فيه تقلب التصنيف —
// "سباك الري" عدّى بسبب 'برمج' (برمجة وحدات الري)، و"فني تشكيل لولبي" عدّى بسبب
// 'صحافة' (الصحافة الكهربائية = مكبس)، و"مشغّل آلة" عدّى بسبب 'ضمان الجودة'.
// نرجع للوصف فقط لما يكون المسمى فاضي (بعض المصادر ما توفّره).
export function passesSectorRule({ company, sector, title, titleAr, description, descriptionAr }) {
  if (isGovernmentJob(company, sector, description, descriptionAr)) return true;

  if (isTargetPrivateSector(title, titleAr, sector)) return true;

  const hasTitle = Boolean(String(title || '').trim() || String(titleAr || '').trim());
  return hasTitle ? false : isTargetPrivateSector(description, descriptionAr);
}
