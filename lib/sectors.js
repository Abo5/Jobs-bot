// النطاقات المستهدفة (أربعة، كلها برمجية/تقنية):
//   1) QA/QC برمجيات      2) DevOps / SRE / Platform
//   3) Cloud (سحابة)       4) الأمن السيبراني بكل فروعه (هجومي ودفاعي)
//
// استثناءات تقبلها القناة فوق النطاقات الأربعة (بطلب المالك 2026-08-18):
//   أ) فتح القبول والتسجيل — جامعات (بكالوريوس · دبلوم · تجسير · ماجستير) ·
//      منح وابتعاث · تمهير · حملات التوظيف العسكرية والمدنية والتجنيد —
//      بالمسمّى الصريح من أي مصدر، وبعبارات الإعلان الرسمية من الجهات المُراقَبة.
//   ب) الوظائف الحكومية — أي وظيفة يثبت الـAI أنها حكومية (is_government).
//   ج) برامج الخريجين والتدريب والابتعاث — من الجهات المُراقَبة وحدها (كما كان).
//
// تغيير النطاق (2026-08-08) بطلب المالك: كان البوت يمرّر تقنية عامة + ذكاء اصطناعي
// + أمن سيبراني + علاقات عامة + إعلام + "أي وظيفة حكومية بأي مجال". انحذفت كلها.
// الوظيفة الحكومية ما عاد لها استثناء: تعدّي فقط لو كانت داخل النطاقات مثل غيرها.
// (أُعيد استثناؤها بطلب المالك 2026-08-18 مع فئة فتح القبول والتسجيل.)
//
// توسعة (2026-08-09) بطلب المالك: أُضيفت DevOps و Cloud و"أي شي له علاقة
// بالسكيورتي" (Red Team · Penetration Testing · SOC · AppSec …) فوق QA.
//
// القاعدة ثلاث طبقات (لازم تعدّي الثلاث):
//   1) إشارة جودة/اختبار في المسمّى الوظيفي
//   2) ما فيها إشارة ميدانية/مدنية/صناعية (في المسمّى أو الوصف)
//   3) سياق برمجيات: إما المسمّى نفسه برمجي بذاته، أو فيه إشارة برمجية بالمسمّى/الوصف
//
// ليش المسمّى لا الوصف (درس سابق محفوظ من 2026-07-26): مطابقة الوصف الحر تمرّر
// وظائف خارج النطاق لأن أي مهمة عابرة تُذكر فيه تقلب التصنيف — "سباك الري" عدّى
// بسبب 'برمجة وحدات الري'، و"مشغّل آلة" عدّى بسبب 'ضمان الجودة'. الوصف يُستخدم
// للاستبعاد ولإثبات السياق البرمجي فقط، ما يُستخدم لإثبات إن الوظيفة QA.

/* ---------- 1) إشارة الجودة/الاختبار (في المسمّى) ---------- */
const QA_SIGNAL_PATTERN = new RegExp(
  [
    '\\bqa\\b', '\\bqc\\b', 'q\\.?a\\.?\\s*/\\s*q\\.?c\\.?', '\\bsdet\\b',
    'quality (assurance|control|engineer|analyst|specialist|lead|manager)',
    'assurance (engineer|analyst|specialist)',
    'tester\\b', 'testing\\b', 'test (engineer|analyst|automation|lead|manager|specialist)',
    'automation (tester|test)',
    'ضمان (ال)?جودة', 'ضبط (ال)?جودة', 'مراقبة (ال)?جودة', 'مراقب (ال)?جودة',
    '(أخصائي|اخصائي|مهندس|محلل|مسؤول) (ال)?جودة',
    'اختبار برمجيات', 'مختبر برمجيات', 'مختبر تطبيقات', 'فاحص برمجيات',
    'مهندس اختبار', 'محلل اختبار', 'أتمتة الاختبار', 'اتمتة الاختبار'
  ].join('|'),
  'i'
);

/* ---------- 1ب) إشارات المجالات المضافة: DevOps · Cloud · Security ---------- */
// مسمّيات حاسمة بذاتها: ما تحتاج إثبات سياق إضافي، ولا يُسقطها مجال الشركة
// (مهندس أمن سيبراني في أرامكو وظيفته سيبرانية حتى لو الوصف يذكر "refinery").
const DEVOPS_TITLE_PATTERN = new RegExp(
  [
    'devops', 'dev.?sec.?ops', 'development operations', '\\bsre\\b', 'site reliability',
    'platform engineer', 'infrastructure engineer', 'systems? engineer.{0,15}(linux|cloud)',
    '(build|release|deployment) engineer', 'ci.?cd engineer', 'automation engineer.{0,15}infra',
    'kubernetes', 'k8s\\b', 'docker\\b', 'terraform', 'ansible', 'gitops',
    'observability engineer', 'monitoring engineer',
    'ديف\\s?اوبس', 'ديفوبس', 'هندسة (ال)?موثوقية', 'مهندس (ال)?بنية (ال)?تحتية'
  ].join('|'), 'i'
);

const CLOUD_TITLE_PATTERN = new RegExp(
  [
    'cloud (engineer|architect|administrator|consultant|specialist|developer|analyst|security)',
    'cloud.?native', 'multi.?cloud', 'hybrid cloud',
    '\\baws\\b', 'amazon web services', '\\bazure\\b', '\\bgcp\\b', 'google cloud',
    'openstack', 'openshift', 'solutions? architect',
    '(ال)?حوسبة (ال)?سحابية', 'مهندس (ال)?سحاب', 'الحلول (ال)?سحابية'
  ].join('|'), 'i'
);

// الأمن السيبراني — هجومي ودفاعي وحوكمة. هذا أوسع نمط عمداً بطلب المالك
// ("أي شي له علاقة بالسكيورتي").
const SECURITY_TITLE_PATTERN = new RegExp(
  [
    // عام
    'cyber ?security', 'information security', 'infosec', 'it security', 'security engineer',
    'security (analyst|architect|consultant|specialist|researcher|administrator|operations)',
    'security operations cent(er|re)', '\\bsoc\\b analyst', '\\bsoc\\b (l\\d|tier)',
    // هجومي
    'red team', 'purple team', 'blue team', 'offensive security',
    'penetration test(er|ing)?', '\\bpen.?test(er|ing)?\\b', '\\bpt\\b testing', '\\bvapt\\b',
    'ethical hack(er|ing)', 'bug bounty', 'exploit development', 'adversary simulation',
    // دفاعي وتحليلي
    'threat (hunt(er|ing)|intelligence|analyst)', 'incident response', '\\bdfir\\b',
    'digital forensic', 'malware (analyst|analysis|research)', 'reverse engineer(ing)?',
    'vulnerability (management|assessment|analyst|researcher)',
    '\\bsiem\\b', '\\bsoar\\b', '\\bedr\\b', '\\bxdr\\b',
    // تطبيقات وسحابة وهوية وحوكمة
    'application security', 'appsec', 'product security', 'cloud security',
    'identity (and|&) access', '\\biam\\b', 'zero trust', 'security (grc|governance|compliance)',
    'iso ?27001', 'nca\\b', 'pci ?dss',
    // عربي
    '(ال)?[أا]من (ال)?سيبراني', '[أا]من (ال)?معلومات', 'اختبار (ال)?اختراق',
    'مخترق [أا]خلاقي', '(ال)?فريق (ال)?[أا]حمر', 'استجابة (ال)?حوادث',
    '(ال)?برمجيات (ال)?خبيثة', '(ال)?[أا]دلة (ال)?رقمية', '(ال)?ثغرات', 'حوكمة (ال)?[أا]من'
  ].join('|'), 'i'
);

// استبعاد الأمن *المادي* — "أمن" بالعربي و"security" بالإنجليزي تشمل الحراسة،
// وهي أكثر مصدر إيجابيات كاذبة في هذا المجال.
const PHYSICAL_SECURITY_PATTERN = new RegExp(
  [
    'security (guard|officer|supervisor|patrol|warden)', 'guard\\b', 'bodyguard',
    'loss prevention', 'cctv', 'access control (installation|technician)',
    'safety (officer|supervisor|inspector)', 'fire safety',
    'حارس', 'حراس(ة|ات)?', '(ال)?[أا]من (وال|و ال|و)?سلامة', 'رجل [أا]من', 'مراقب [أا]من',
    'كاميرات (ال)?مراقبة', 'الحراسات (ال)?[أا]منية'
  ].join('|'), 'i'
);

/* ---------- 2) الاستبعاد الميداني/المدني/الصناعي ---------- */
// هذي هي الطبقة اللي طلبها المالك صراحة: "وليس civil ولا شي ميداني".
// "QA/QC Engineer" في السعودية غالباً وظيفة إنشاءات — فنقتلها بإشارات المجال.
// تُطبَّق على المسمّى + الوصف معاً لأن الوصف هو اللي يكشف الطبيعة الميدانية
// ("site visits", "زيارات ميدانية", "welding inspection") حتى لو المسمّى محايد.
const FIELD_EXCLUSION_PATTERN = new RegExp(
  [
    // إنشاءات وهندسة مدنية
    'civil\\b', 'construction', 'structural', 'concrete', 'rebar', 'asphalt', 'surveyor',
    'piping', 'pipeline', 'welding', 'weld\\b', 'painting', 'coating', 'scaffold',
    'commissioning', 'site (engineer|inspector|supervisor|manager|visit)', 'on.?site inspection',
    'مدني', 'إنشاء(ات|ي)', 'انشاء(ات|ي)', 'خرسان', 'حديد التسليح', 'لحام', 'أعمال الموقع',
    'مهندس موقع', 'مشرف موقع', 'مساح\\b', 'مساحة أراضي', 'ميداني', 'الميداني', 'زيارات ميدانية',
    // فحص غير إتلافي وسلامة
    '\\bndt\\b', 'non.?destructive', 'radiograph', 'ultrasonic', '\\bhse\\b', '\\bhsse\\b',
    'health.{0,3}safety', 'occupational safety', 'السلامة المهنية', 'الصحة والسلامة',
    // تصنيع ومصانع ومختبرات مادية
    'manufactur', 'factory', 'production line', 'assembly line', 'machining', 'fabrication',
    'foundry', 'refinery', 'petrochemical', 'oil.{0,3}(and|&).{0,3}gas', 'drilling', 'offshore',
    'mechanical (engineer|inspector|technician)', 'electrical (engineer|inspector|technician)',
    'instrumentation', 'calibration', 'metrolog',
    // سيارات ومصانع تجميع — "General Assembly Quality Manager @ Lucid Motors" عدّى
    // الفلتر لأن نبذة الشركة تقول "software-defined vehicle architecture"، فبويلربليت
    // التعريف بالشركة منحته سياقاً برمجياً وهو مدير جودة خط تجميع سيارات.
    'general assembly', 'automotive', 'vehicle', 'body shop', 'paint shop', 'stamping',
    'powertrain', 'مركبات', 'سيارات', 'خط التجميع',
    'مصنع', 'المصانع', 'خط الإنتاج', 'خط الانتاج', 'تصنيع', 'مصفاة', 'بتروكيماوي',
    'حفر\\b', 'ميكانيك', 'كهربائ', 'معايرة',
    // أغذية ودواء ومختبرات
    'food safety', '\\bhaccp\\b', '\\bgmp\\b', 'pharmaceutic', 'laborator', 'lab technician',
    'chemical analysis', 'microbiolog', 'سلامة الغذاء', 'الأغذية', 'صيدلان', 'مختبر كيميائي',
    'مختبر طبي', 'تحاليل',
    // أنظمة إدارة جودة تنظيمية (ISO) — جودة مؤسسية مو اختبار برمجيات
    'iso ?9001', 'iso ?14001', 'iso ?45001', '\\bqms\\b', 'quality management system',
    'نظام إدارة الجودة', 'نظام ادارة الجودة', 'الأيزو', 'الايزو',
    // مجالات ميدانية أخرى شائعة بإعلانات "جودة"
    'textile', 'garment', 'apparel', 'agricultur', 'poultry', 'dairy', 'warehouse', 'logistics',
    'supply chain', 'نسيج', 'زراع', 'دواجن', 'ألبان', 'مستودع', 'سلسلة الإمداد', 'الإمداد'
  ].join('|'),
  'i'
);

/* ---------- 3) السياق البرمجي ---------- */
// مسمّيات برمجية بذاتها — تعدّي بدون ما نحتاج دليل إضافي من الوصف
const INHERENTLY_SOFTWARE_QA_PATTERN = new RegExp(
  [
    '\\bsdet\\b', 'software (qa|quality|test)', '(qa|quality|test) .{0,12}software',
    // "Senior Software Engineer, Quality Engineering" — وجود "software engineer"
    // مع إشارة جودة في نفس المسمّى يحسمها كبرمجية مهما قال الوصف.
    'software engineer.{0,25}(qa|quality|test)', '(qa|quality|test).{0,25}software engineer',
    'qa (automation|engineer|analyst|tester|lead)', 'automation (qa|tester|test engineer)',
    'test automation', 'application tester', 'web tester', 'mobile (app )?tester',
    'manual tester', 'game tester', 'api tester', 'performance tester',
    'اختبار برمجيات', 'مختبر برمجيات', 'مختبر تطبيقات', 'فاحص برمجيات',
    'جودة برمجيات', 'أتمتة الاختبار', 'اتمتة الاختبار', 'اختبار التطبيقات'
  ].join('|'),
  'i'
);

// إشارات برمجية عامة — يُقبل ظهورها بالمسمّى أو الوصف كإثبات إن الـQA على نظام/موقع
// ملاحظة: تعمّدنا استبعاد كلمة 'system' و'نظام' المجرّدتين — "quality management system"
// و"نظام إدارة الجودة" هي بالضبط جودة المصانع اللي نبي نستبعدها، فتقلب الفلتر ضدنا.
const SOFTWARE_CONTEXT_PATTERN = new RegExp(
  [
    'software', 'web (app|application|site|based)', 'website', 'mobile (app|application)',
    'application(s)? (testing|development)', '\\bapi\\b', 'restful|rest api', 'microservice',
    'front.?end', 'back.?end', 'full.?stack', '\\bui\\b', '\\bux\\b', 'database', '\\bsql\\b',
    'selenium', 'cypress', 'playwright', 'appium', 'postman', 'jmeter', 'testng', 'junit',
    'pytest', 'robot framework', 'katalon', 'jira\\b', 'xray\\b', 'testrail', 'zephyr\\b',
    'test (case|plan|script|suite|scenario)', 'regression testing', 'functional testing',
    'integration testing', 'unit testing', 'smoke testing', 'usability testing',
    'load testing', 'stress testing', 'penetration testing', 'bug (tracking|report)',
    'defect (tracking|management)', 'ci/?cd', 'jenkins', 'git(hub|lab)?\\b', 'devops',
    'agile\\b', 'scrum\\b', 'sprint\\b', 'sdlc', 'stlc',
    'programming', 'coding', 'python', 'java\\b', 'javascript', 'typescript', 'c#',
    // تنبيه: لا تكتب '\\bit\\b' هنا — الregex غير حسّاس لحالة الأحرف فيطابق كلمة
    // "it" الإنجليزية العادية في أي وصف، فيمنح سياقاً برمجياً لوظائف جودة مصانع.
    'information technology', 'it (department|team|systems?|services|support|infrastructure|projects?)',
    'saas\\b', 'platform (testing|quality)',
    'digital product', 'e.?commerce platform',
    // تنبيه: أداة "ال" التعريف تنكسر المطابقة في العبارات المركّبة — "المواقع الإلكترونية"
    // ما تطابق نمط 'مواقع إلكترونية' لأن "ال" تدخل بين الكلمتين. كل عبارة عربية هنا
    // لازم تخلي (ال)? اختيارية على الكلمة الثانية، والهمزة تُكتب أحياناً بدونها (اداء/أداء).
    'برمجيات', 'برمجة', 'تطبيق(ات)?',
    '(موقع|مواقع) (ال)?[إا]لكتروني(ة)?', '(صفحات|واجهات?) (ال)?ويب', 'الويب\\b',
    'واجهات? برمجية', 'قواعد (ال)?بيانات',
    'حالات (ال)?اختبار', 'سيناريوهات (ال)?اختبار', 'خطة (ال)?اختبار',
    'اختبار (ال)?[أا]داء', 'اختبار (ال)?انحدار', 'اختبار (ال)?وحدة', 'اختبار (ال)?تكامل',
    'تتبع (ال)?[أا]خطاء', 'إدارة (ال)?عيوب', 'تقنية (ال)?معلومات', '[أا]نظمة برمجية',
    'أجايل', 'سكرم', 'دورة حياة (ال)?برمجيات'
  ].join('|'),
  'i'
);

const join = fields => fields.filter(Boolean).join(' ');

export function hasQaSignal(...fields) {
  return QA_SIGNAL_PATTERN.test(join(fields));
}

export function isFieldOrCivilJob(...fields) {
  return FIELD_EXCLUSION_PATTERN.test(join(fields));
}

export function hasSoftwareContext(...fields) {
  return SOFTWARE_CONTEXT_PATTERN.test(join(fields));
}

export function isInherentlySoftwareQa(...fields) {
  return INHERENTLY_SOFTWARE_QA_PATTERN.test(join(fields));
}

// برامج التوظيف والتدريب والابتعاث التي تنشرها الجهات شبه الحكومية دورياً.
// تُقبل *فقط* من الجهات المُراقَبة في entities.json — لأنها بلا مسمّى تقني،
// فقبولها من أي مصدر كان بيغرق القناة بإعلانات تدريب عامة.
const PROGRAM_PATTERN = new RegExp(
  [
    'graduate (program|programme|development|trainee|scheme)', 'graduate hiring',
    'fresh graduate', 'new grad', '\\bgrad\\b program',
    'trainee program', 'traineeship', 'internship', '\\bintern\\b', 'co.?op (training|program)',
    'apprentice(ship)?', 'talent (program|pipeline|acceleration)', 'development program',
    'scholarship', 'sponsorship program', 'tamheer', 'summer (program|internship)',
    'rotational program', 'early career', 'entry.level program', 'career fair',
    'برنامج (ال)?خريج', 'برامج (ال)?خريج', 'تطوير (ال)?خريج', 'الخريجين',
    'تمهير', 'ابتعاث', 'منح دراسية', 'منحة', 'تدريب تعاوني', 'التدريب (ال)?تعاوني',
    'تدريب صيفي', 'برنامج تدريب', 'برنامج (ال)?تميز', 'حديثي (ال)?تخرج',
    'مبتعث', 'يوم مهني', 'ملتقى توظيف', 'التوظيف (ال)?مباشر'
  ].join('|'), 'i'
);

export function isGraduateProgram(...f) { return PROGRAM_PATTERN.test(join(f)); }

/* ---------- فتح القبول والتسجيل (الفئة الجديدة 2026-08-18) ---------- */
// إعلانات فتح باب القبول والتسجيل: جامعات (بكالوريوس · دبلوم · تجسير · ماجستير) ·
// منح وابتعاث · تمهير · حملات التوظيف العسكرية/المدنية والتجنيد.
//
// الحوكمة طبقتان (نفس درس "المسمّى لا الوصف"):
//   ١) من أي مصدر: المسمّى (أو المسمّى العربي) وحده يحسم — إشارة إعلان صريحة.
//   ٢) من الجهات المُراقَبة فقط (linkedin-entity): عبارات الإعلان الرسمية
//      تُقبل حتى لو ظهرت في الوصف لا المسمّى — الجهة موثّقة فالعبارة كافية.
//
// حماية من الفيضان: "بكالوريوس" مجرّدة في مسمّى وظيفة ("مهندس — بكالوريوس") ما
// تقبل؛ لازم سياق برنامج/قبول/تسجيل. ولا نطابق "تدريب تعاوني" من غير الجهات
// حتى لا نغرق القناة بإعلانات تدريب عامة (درس 2026-08-09).

// طبقة ١: المسمّى الصريح — تُقبل من أي مصدر
const ADMISSION_TITLE_PATTERN = new RegExp(
  [
    // أفعال الإعلان الصريحة
    'فتح (باب )?(ال)?(قبول|تسجيل|تقديم)', 'بدء (ال)?(تسجيل|تقديم|قبول)',
    'إعلان (فتح )?(ال)?(قبول|تسجيل|تقديم)',
    'استقبال (ال)?طلبات', 'بوابة (ال)?(قبول|تسجيل|توظيف)',
    '(ال)?(قبول|تسجيل|تقديم) (ال)?(موحد|مفتوح|إلكتروني|متاح)',
    '(ال)?تسجيل (ال)?متاح', 'يستمر (ال)?(تسجيل|تقديم|قبول)',
    // دراسي — سياق برنامج صريح (بكالوريوس مجرّدة لا تكفي)
    'برنامج (ال)?(بكالوريوس|دبلوم|تجسير|ماجستير|قبول|ابتعاث)',
    'بكالوريوس (ال)?تجسير', 'تجسير (إلى|الى|بعد)', 'التجسير', 'تجسير',
    'دبلوم (ال)?(عال|عالي|مشارك)', 'منح دراسية', 'منحة (دراسية|ابتعاث)',
    'ابتعاث (داخلي|خارجي|طلاب|موظفين)?', 'برنامج تمهير', 'تمهير',
    // عسكري ومدني
    'التجنيد', 'تجنيد', 'وظائف (عسكرية|مدنية)', 'وظيفة (عسكرية|مدنية)',
    'رتب عسكرية', 'القوات المسلحة', 'الحرس الوطني',
    '(ال)?كلية (ال)?(عسكرية|حربية|جوية|بحرية|الأمنية|الضباط)',
    'كلية .{0,25}(عسكرية|حربية|جوية|بحرية)', 'الكلية (ال)?(عسكرية|حربية|جوية|بحرية|الأمنية)',
    'وزارة (ال)?دفاع', 'الدفاع (ال)?مدني', 'حملة (التوظيف|توظيف)',
    'التوظيف (ال)?المركزي',
    // إنجليزي
    'admission(s)? (now )?(open|opening)', 'enrollment (now )?(open|opens)',
    'registration (now )?(open|opens)', 'application (window|period) (open|opens)',
    'hiring campaign', 'recruitment (campaign|drive)', 'mass (hiring|recruitment)',
    'open recruitment', "bachelor('?s)? (degree )?program", 'diploma program',
    'bridging (program|degree)', 'military recruitment', 'defense forces? recruitment',
    '\\btamheer\\b'
  ].join('|'),
  'i'
);

// طبقة ٢: عبارات الإعلان الرسمية — تُقبل من الجهات المُراقَبة فقط (أي حقل)
const ADMISSION_ANNOUNCE_PATTERN = new RegExp(
  [
    'فتح باب (ال)?(قبول|تسجيل|تقديم)', 'بدء (ال)?(تسجيل|تقديم|قبول)',
    'استقبال طلبات (ال)?(قبول|تسجيل|تقديم)?', '(ال)?باب (ال)?(قبول|تسجيل) مفتوح',
    '(ال)?تسجيل مفتوح', 'أعلنت? (عن )?(فتح|بدء|استقبال)',
    'يعلن (عن )?(فتح|بدء|استقبال)', 'تعلن (عن )?(فتح|بدء|استقبال)',
    'يدعو (إلى|الى) (ال)?(تقديم|تسجيل)', 'القبول والتسجيل',
    'registration is (now )?open', 'applications are (now )?open'
  ].join('|'),
  'i'
);

/** طبقة ١: مسمّى صريح لفتح قبول/تسجيل — تقبل من أي مصدر */
export function isAdmissionTitle(...f) { return ADMISSION_TITLE_PATTERN.test(join(f)); }

/** طبقة ٢: عبارة إعلان رسمية في أي حقل — تقبل من الجهات المُراقَبة فقط */
export function isAdmissionAnnouncement(...f) { return ADMISSION_ANNOUNCE_PATTERN.test(join(f)); }

/**
 * التصنيف الحتمي للوظيفة المقبولة — يُشتق محلياً من البيانات لا من الذكاء
 * الاصطناعي، حتى لا يُخترع الوسم أبداً. يُستخدم في رسالة القناة والتقرير.
 * ترجّع { label, emoji } أو null.
 */
export function categoryForJob(j) {
  if (j.is_admission) {
    const entity = j.entity || '';
    return { emoji: '📢', label: `فتح قبول وتسجيل${entity ? ` — ${entity}` : ''}` };
  }
  if (j.is_government) return { emoji: '🏛️', label: 'وظيفة حكومية' };
  if (j.is_program) {
    const entity = j.entity || '';
    return { emoji: '🎓', label: `برنامج توظيف/تدريب${entity ? ` — ${entity}` : ''}` };
  }
  const d = evaluateTargetRole({
    company: j.company, sector: j.sector, title: j.job_title, titleAr: j.job_title_ar,
    description: j.description, descriptionAr: j.description_ar, requirements: j.requirements
  }).domain;
  return d ? { emoji: '📌', label: d } : { emoji: '📌', label: 'فرصة وظيفية' };
}

export function isDevopsRole(...f) { return DEVOPS_TITLE_PATTERN.test(join(f)); }
export function isCloudRole(...f) { return CLOUD_TITLE_PATTERN.test(join(f)); }
export function isSecurityRole(...f) { return SECURITY_TITLE_PATTERN.test(join(f)); }
export function isPhysicalSecurity(...f) { return PHYSICAL_SECURITY_PATTERN.test(join(f)); }

/** إشارة انتماء لأي نطاق مستهدف — تُستخدم لاختيار ما يستحق إثراء الوصف */
export function hasTargetSignal(...f) {
  const t = join(f);
  return QA_SIGNAL_PATTERN.test(t) || DEVOPS_TITLE_PATTERN.test(t)
      || CLOUD_TITLE_PATTERN.test(t) || SECURITY_TITLE_PATTERN.test(t);
}

/**
 * القاعدة النهائية للنطاقات الأربعة.
 * ترجّع { pass, reason, domain } — الـreason للتشخيص في اللوق.
 */
export function evaluateTargetRole(job) {
  const { company, sector, title, titleAr, description, descriptionAr, requirements } = job;
  const titleText = join([title, titleAr]);
  const reqText = Array.isArray(requirements) ? requirements.join(' ') : String(requirements || '');
  const bodyText = join([description, descriptionAr, reqText, sector, company]);
  const surface = titleText.trim() ? titleText : bodyText;

  // أمن مادي/حراسة — يُقتل أولاً: "Security Officer" و"حارس أمن" يطابقان
  // إشارة الأمن لكنهما ليسا سيبرانيين إطلاقاً.
  if (isPhysicalSecurity(surface)) return { pass: false, reason: 'physical-security', domain: null };

  // DevOps · Cloud · Security: المسمّى وحده حاسم. لا نُخضعها للاستبعاد الميداني
  // على الوصف لأن مجال الشركة (بترول · مصانع · لوجستيات) لا يغيّر طبيعة الدور —
  // مهندس أمن سيبراني في مصفاة وظيفته سيبرانية.
  if (isSecurityRole(surface)) return { pass: true, reason: 'security-title', domain: 'الأمن السيبراني' };
  if (isDevopsRole(surface))   return { pass: true, reason: 'devops-title',   domain: 'DevOps' };
  if (isCloudRole(surface))    return { pass: true, reason: 'cloud-title',    domain: 'السحابة' };

  // QA — يبقى بقاعدته الأصلية الأشد، لأن "QA/QC Engineer" في السعودية غالباً إنشاءات
  if (!hasQaSignal(surface)) return { pass: false, reason: 'no-target-signal', domain: null };
  return { ...evaluateQaSoftware(job), domain: 'ضمان الجودة' };
}

/**
 * قاعدة QA/QC البرمجيات وحدها (طبقة داخلية يستدعيها evaluateTargetRole).
 * ترجّع { pass, reason } — الـreason للتشخيص في اللوق (ليش انرفضت الوظيفة).
 */
export function evaluateQaSoftware({ company, sector, title, titleAr, description, descriptionAr, requirements }) {
  const titleText = join([title, titleAr]);
  const reqText = Array.isArray(requirements) ? requirements.join(' ') : String(requirements || '');
  const bodyText = join([description, descriptionAr, reqText, sector, company]);

  // المسمّى هو المرجع؛ نرجع للوصف فقط لما المسمّى فاضي (بعض المصادر ما توفّره)
  const qaSurface = titleText.trim() ? titleText : bodyText;
  if (!hasQaSignal(qaSurface)) return { pass: false, reason: 'no-qa-signal' };

  // المسمّى ميداني صراحة ("QA/QC Civil Inspector") — مرفوض مهما كان الوصف
  if (isFieldOrCivilJob(titleText)) return { pass: false, reason: 'field-title' };

  // ترتيب مقصود: المسمّى البرمجي الصريح ("Software Test Engineer") يعدّي قبل فحص
  // الاستبعاد الميداني على الوصف — لأن شركة إنشاءات أو لوجستيات أو بترول تقدر
  // توظّف مختبر برمجيات، وكلمة مجالها بالوصف كانت ترفضه بالغلط.
  if (isInherentlySoftwareQa(titleText)) {
    // المسمّى البرمجي الصريح ("Software Test Engineer" · SDET · "Test Automation")
    // يمرّ دائماً — حتى لو الوصف يذكر مجال الشركة الميداني.
    const explicit = hasSoftwareContext(titleText)
      || /\bsdet\b|test automation|automation (qa|tester|test engineer)/i.test(titleText);
    if (explicit) return { pass: true, reason: 'software-qa-title' };
    // مسمّى عام ("QA Engineer") — يمرّ إلا إذا الوصف نفسه ميداني صراحةً. بدون
    // وصف يمرّ كما كان، فما نخسر المصادر اللي ما توفّر وصفاً.
    if (isFieldOrCivilJob(bodyText)) return { pass: false, reason: 'generic-title-field-body' };
    return { pass: true, reason: 'generic-qa-title' };
  }

  // مسمّى عام ("QA Engineer") — هنا نتشدد: لازم سياق برمجي وبدون أي إشارة ميدانية
  if (isFieldOrCivilJob(bodyText)) return { pass: false, reason: 'field-or-civil' };
  if (hasSoftwareContext(join([titleText, bodyText]))) return { pass: true, reason: 'software-context' };

  return { pass: false, reason: 'no-software-context' };
}

export function passesSectorRule(job) {
  return evaluateTargetRole(job).pass;
}
