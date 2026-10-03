// מקורות המידע של "דופק".
// topic: הנושא שאליו הפריטים ישויכו. בלי topic הסיווג נעשה לפי מילות מפתח.
// fallback: נושא ברירת מחדל למקור שרוצים לראות ממנו הכל (גם אם אין התאמה למילות מפתח).
// להוספת מקור: מוסיפים שורה ל-directFeeds. להוספת חיפוש: מוסיפים שורה ל-googleQueries.

export const TOPICS = {
  econ:         { label: 'כלכלה ושוק ההון' },
  demo:         { label: 'דמוגרפיה וחברה' },
  deals:        { label: 'עסקאות והייטק' },
  research:     { label: 'מחקרים ודוחות' },
  knesset:      { label: 'הכנסת והממשל' },
  laws:         { label: 'חוקים חדשים' },
  factcheck:    { label: 'נאמר מול המציאות' },
  media:        { label: 'בדיקת תקשורת' },
  israelAbroad: { label: 'ישראל בעולם' },
  defense:      { label: 'עסקאות ביטחוניות' },
  world:        { label: 'ממשל בעולם' },
};

// פידים ישירים
export const directFeeds = [
  // ישראל
  { name: 'גלובס', url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=2' },
  { name: 'ynet כלכלה', url: 'https://www.ynet.co.il/Integration/StoryRss6.xml', topic: 'econ' },
  { name: 'שקוף', url: 'https://shakuf.co.il/feed', fallback: 'knesset' },
  { name: 'העין השביעית', url: 'https://www.the7eye.org.il/feed', topic: 'media' },  // כלב השמירה של התקשורת
  { name: 'Times of Israel', url: 'https://www.timesofisrael.com/feed/' },
  // עולם
  { name: 'Wall Street Journal', url: 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews' },
  { name: 'Wall Street Journal', url: 'https://feeds.content.dowjones.io/public/rss/socialeconomyfeed' },
  { name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml' },
  { name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml' },
  { name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/israel/rss', fallback: 'israelAbroad' },
  { name: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml' },
];

// חיפושים ב-Google News (24 השעות האחרונות). lang: 'en' = חיפוש בחדשות בעולם באנגלית
export const googleQueries = [
  // כלכלה
  { q: 'בנק ישראל ריבית', topic: 'econ' },
  { q: '"מדד המחירים לצרכן"', topic: 'econ' },
  { q: 'תקציב המדינה משרד האוצר', topic: 'econ' },
  { q: 'הבורסה בתל אביב מדד', topic: 'econ' },
  // דמוגרפיה וחברה
  { q: 'הלשכה המרכזית לסטטיסטיקה', topic: 'demo' },
  { q: 'הלמ"ס נתונים', topic: 'demo' },
  { q: 'אוכלוסיית ישראל ילודה הגירה', topic: 'demo' },
  { q: 'שוק העבודה אבטלה שכר ממוצע', topic: 'demo' },
  { q: 'ירידה מהארץ עזבו את ישראל נתונים', topic: 'demo' },
  { q: 'שיעור הפריון ילדים לאישה ישראל', topic: 'demo' },
  { q: 'דוח העוני ביטוח לאומי', topic: 'demo' },
  { q: 'תעסוקת חרדים ערבים נתונים', topic: 'demo' },
  { q: 'מספר תושבי ישראל אוכלוסייה', topic: 'demo' },
  { q: 'עלייה לישראל עולים חדשים נתונים', topic: 'demo' },
  { q: 'יוקר המחיה מחירי הדיור נתונים', topic: 'demo' },
  { q: 'סקר ישראלים מרכז טאוב OR "המכון הישראלי לדמוקרטיה"', topic: 'demo' },
  // נאמר מול המציאות — בדיקות עובדות
  { q: 'בדיקת עובדות "המשרוקית" OR "בודק העובדות" OR "פקט צ\'ק"', topic: 'factcheck' },
  { q: 'site:shakuf.co.il', topic: 'factcheck' },
  { q: 'טענה לא נכונה נתונים מראים', topic: 'factcheck' },
  // בדיקת תקשורת — טענות של עיתונאים ומשפיענים
  { q: 'FakeReporter', topic: 'media' },
  { q: 'פייק ניוז ידיעה כוזבת הופצה ברשתות', topic: 'media' },
  { q: 'דיווח שגוי תיקון התנצלות כתבה', topic: 'media' },
  { q: 'מכחיש את הדיווח "אין אמת"', topic: 'media' },
  { q: 'משפיענית OR משפיען טענה ברשת התברר', topic: 'media' },
  { q: 'site:the7eye.org.il', topic: 'media' },
  { q: 'Israel misinformation viral claim debunked', topic: 'media', lang: 'en' },
  // עסקאות והייטק
  { q: 'אקזיט סטארטאפ ישראלי', topic: 'deals' },
  { q: 'נרכשה תמורת מיליון דולר', topic: 'deals' },
  { q: 'גייסה מיליון דולר סבב', topic: 'deals' },
  { q: 'מיזוג רכישה עסקה מיליארד', topic: 'deals' },
  // מחקרים
  { q: 'מחקר חדש ישראל ממצאים', topic: 'research' },
  { q: 'המכון הישראלי לדמוקרטיה', topic: 'research' },
  { q: 'מרכז טאוב מחקר', topic: 'research' },
  { q: 'מכון אהרן למדיניות כלכלית', topic: 'research' },
  { q: 'דוח מבקר המדינה', topic: 'research' },
  { q: 'OECD ישראל דוח', topic: 'research' },
  // הכנסת והממשל
  { q: 'חבר הכנסת אמר', topic: 'knesset' },
  { q: 'ועדת הכספים של הכנסת', topic: 'knesset' },
  { q: 'מליאת הכנסת', topic: 'knesset' },
  { q: 'site:shakuf.co.il', topic: 'knesset' },
  // חוקים
  { q: '"בקריאה שלישית"', topic: 'laws' },
  { q: '"בקריאה ראשונה" הצעת חוק', topic: 'laws' },
  { q: 'ועדת השרים לחקיקה אישרה', topic: 'laws' },
  // ישראל בעולם — אהדה ודעת קהל
  { q: 'Israel poll support Americans', topic: 'israelAbroad', lang: 'en' },
  { q: 'Israel public opinion Europe', topic: 'israelAbroad', lang: 'en' },
  { q: 'Israel boycott OR sanctions OR recognition Palestinian state', topic: 'israelAbroad', lang: 'en' },
  { q: 'דעת הקהל בעולם ישראל סקר', topic: 'israelAbroad' },
  { q: 'אנטישמיות בעולם', topic: 'israelAbroad' },
  // עסקאות ביטחוניות
  { q: 'Israel arms deal OR defense contract', topic: 'defense', lang: 'en' },
  { q: 'Elbit OR Rafael OR "Israel Aerospace Industries" contract', topic: 'defense', lang: 'en' },
  { q: 'US military aid Israel weapons', topic: 'defense', lang: 'en' },
  { q: 'עסקה ביטחונית אלביט רפאל התעשייה האווירית', topic: 'defense' },
  { q: 'יצוא ביטחוני ישראל', topic: 'defense' },
  // ממשל בעולם
  { q: 'election results government parliament', topic: 'world', lang: 'en' },
  { q: 'new law passed parliament', topic: 'world', lang: 'en' },
];

export const googleNewsUrl = (q, lang = 'he') => lang === 'en'
  ? `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&hl=en-US&gl=US&ceid=US:en`
  : `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&hl=iw&gl=IL&ceid=IL:he`;

// מילות מפתח לסיווג (הסדר חשוב: הראשון שמתאים קובע). אנגלית — לא תלוי באותיות גדולות.
export const topicKeywords = {
  media: ['פייק ניוז', 'ידיעה כוזבת', 'ידיעה שקרית', 'דיווח שגוי', 'דיווח כוזב', 'פרסום כוזב', 'FakeReporter', 'פייק ריפורטר', 'הפצת שקרים', 'מידע כוזב', 'דיסאינפורמציה', 'אין אמת בדיווח', 'אין אמת בפרסום', 'הכחיש את הדיווח', 'misinformation', 'disinformation', 'debunk', 'false claim', 'fake news'],
  factcheck: ['בדיקת עובדות', 'המשרוקית', 'בודק העובדות', 'פקט צ\'ק', 'fact check', 'fact-check', 'טענה שגויה', 'לא מדויק', 'הטעיה'],
  laws: ['קריאה שלישית', 'קריאה ראשונה', 'קריאה שנייה', 'הצעת חוק', 'אושר החוק', 'ועדת השרים לחקיקה', 'תיקון לחוק'],
  defense: ['עסקה ביטחונית', 'עסקת נשק', 'עסקת הנשק', 'אלביט', 'רפאל', 'התעשייה האווירית', 'יצוא ביטחוני', 'סיוע ביטחוני', 'כיפת ברזל', 'חץ 3', 'קלע דוד', 'F-35', 'סיב"ט',
    'arms deal', 'arms sale', 'weapons sale', 'defense contract', 'defence contract', 'elbit', 'rafael', 'israel aerospace', 'iron dome', "david's sling", 'arrow 3', 'military aid', 'arms export', 'arms embargo', 'pentagon contract', 'procurement'],
  israelAbroad: ['דעת הקהל', 'תמיכה בישראל', 'אהדה לישראל', 'חרם על ישראל', 'BDS', 'אנטישמיות', 'דימוי ישראל', 'הכרה במדינה פלסטינית',
    'israel poll', 'support for israel', 'sympathy', 'public opinion', 'antisemitism', 'boycott', 'bds', 'recognize palestin', 'recognition of palestin', 'campus protest', 'pro-israel', 'pro-palestinian', 'gallup', 'pew research'],
  knesset: ['הכנסת', 'ח"כ', 'חבר הכנסת', 'חברת הכנסת', 'מליאה', 'ועדת הכספים', 'קואליציה', 'אופוזיציה', ' השר ', ' השרה ', ' שר ה', 'משרד ראש הממשלה', 'knesset', 'netanyahu'],
  demo: ['הלמ"ס', 'למ"ס', 'הלשכה המרכזית לסטטיסטיקה', 'אוכלוסי', 'ילודה', 'פריון', 'הגירה', 'ירידה מהארץ', 'עזבו את ישראל', 'עזבו את הארץ', 'עלייה לישראל', 'עולים חדשים', 'אבטלה', 'שיעור התעסוקה', 'תעסוקת', 'שכר ממוצע', 'שכר החציוני', 'תוחלת חיים', 'דמוגרפ', 'דוח העוני', 'קו העוני', 'יוקר המחיה', 'מחירי הדירות', 'נישואין', 'גירושין', 'ביטוח לאומי', 'מרכז טאוב'],
  research: ['מחקר', 'סקר', 'דוח', 'דו"ח', 'מבקר המדינה', 'OECD', 'המכון הישראלי לדמוקרטיה', 'מרכז טאוב', 'מכון אהרן', 'ממצאים'],
  deals: ['אקזיט', 'נרכשה', 'רכישת', 'מיזוג', 'גייסה', 'גיוס', 'סטארטאפ', 'הייטק', 'הנפקה', 'IPO', 'עסקה', 'יוניקורן', 'israeli startup', 'acquisition', 'acquires'],
  econ: ['ריבית', 'אינפלציה', 'מדד', 'בורסה', 'תקציב', 'גירעון', 'צמיחה', 'תמ"ג', 'בנק ישראל', 'האוצר', 'שקל', 'דולר', 'מניות', 'משכנתא', 'מחירי הדיור', 'מס '],
  world: ['election', 'parliament', 'prime minister', 'president', 'government', 'coalition', 'referendum', 'congress', 'senate', 'supreme court', 'legislation', 'law ', 'tariff', 'central bank', 'sanction', 'minister',
    'הבית הלבן', 'הקונגרס', 'האיחוד האירופי', 'הפרלמנט'],
};

// מה הופך ידיעה ל"חשובה" (שולח פוש)
export const importantKeywords = [
  { k: 'ריבית', w: 2 }, { k: 'קריאה שלישית', w: 3 }, { k: 'אקזיט', w: 3 },
  { k: 'מיליארד', w: 2 }, { k: 'הלמ"ס', w: 2 }, { k: 'הלשכה המרכזית לסטטיסטיקה', w: 2 },
  { k: 'מדד המחירים', w: 3 }, { k: 'אינפלציה', w: 2 }, { k: 'אבטלה', w: 2 },
  { k: 'תמ"ג', w: 2 }, { k: 'צמיחה', w: 1 }, { k: 'דירוג האשראי', w: 3 },
  { k: 'מבקר המדינה', w: 2 }, { k: 'תקציב המדינה', w: 2 }, { k: 'נרכשה', w: 2 },
  { k: 'שיא', w: 1 }, { k: 'לראשונה', w: 1 }, { k: 'דרמטי', w: 1 }, { k: 'OECD', w: 1 },
  { k: 'נגיד בנק ישראל', w: 2 }, { k: 'גירעון', w: 1 },
  { k: 'עסקת נשק', w: 3 }, { k: 'עסקה ביטחונית', w: 3 }, { k: 'אמברגו', w: 3 },
  { k: 'arms deal', w: 3 }, { k: 'arms sale', w: 3 }, { k: 'arms embargo', w: 3 }, { k: 'billion', w: 1 },
  { k: 'israel poll', w: 2 }, { k: 'support for israel', w: 2 }, { k: 'sanctions on israel', w: 3 },
  { k: 'recogni', w: 1 }, { k: 'israel', w: 1 },
];
export const IMPORTANT_THRESHOLD = 3;

// בונוס עדיפות לפי נושא — דמוגרפיה ו"מה נכון ומה לא" במרכז
export const topicBonus = { demo: 2, factcheck: 2, media: 2, laws: 1, knesset: 1 };

// מקורות ומילים שלא רוצים לראות (ספורט, אתרי תוכן זבל וכו')
export const blockedSources = [
  // אתרי ארגוני הסברה ואקטיביזם (משני הצדדים) — לא מקורות חדשותיים
  'bds movement', 'bdsmovement', 'mondoweiss', 'electronic intifada', 'electronicintifada', 'middle east monitor', 'middleeastmonitor', 'palestine chronicle', 'standwithus', 'honestreporting', 'honest reporting', 'camera.org', 'israel365', 'billy graham', 'substack', 'medium.com', 'blogspot', 'wordpress.com',
  'vietnam.vn', 'facebook.com', 'talksport', 'yahoo sports', 'vijesti', 'edp24', 'youtube', 'instagram', 'x.com', 'tiktok', 'sport5', 'one.co.il', 'espn'];
export const blockedWords = ['UFC', 'NBA', 'NFL', 'Premier League', 'כדורגל', 'כדורסל', 'מכבי תל אביב', 'הפועל ', 'ליגת העל', 'יורוליג', 'מונדיאל', 'הורוסקופ'];
