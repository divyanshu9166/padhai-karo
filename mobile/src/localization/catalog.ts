/**
 * EN/HI localized string catalog (Req 10).
 *
 * COPIED FROM: backend/src/lib/localization/catalog.ts (verbatim).
 * See ./types.ts for the copy rationale. Keep in sync with the backend copy.
 *
 * Every entry carries an English (`en`) value; `hi` is provided where a translation exists.
 * A handful of keys deliberately omit `hi` to exercise the English fallback path required by
 * Req 10.3 (see `paywall.restorePurchase` and `common.retry`).
 */

import type { LocalizedString, StringCatalog } from './types';

/**
 * The shipped string catalog. Declared `as const` so each value's key is preserved in the
 * type, letting `StringKey` enumerate the exact set of known keys for callers.
 */
export const stringCatalog = {
    // ── Common actions ────────────────────────────────────────────────────────────────
    'common.save': { en: 'Save', hi: 'सहेजें' },
    'common.cancel': { en: 'Cancel', hi: 'रद्द करें' },
    'common.delete': { en: 'Delete', hi: 'हटाएं' },
    'common.edit': { en: 'Edit', hi: 'संपादित करें' },
    'common.next': { en: 'Next', hi: 'अगला' },
    'common.back': { en: 'Back', hi: 'पीछे' },
    'common.done': { en: 'Done', hi: 'पूर्ण' },
    'common.loading': { en: 'Loading…', hi: 'लोड हो रहा है…' },
    // Intentionally missing `hi` — exercises the English fallback (Req 10.3).
    'common.retry': { en: 'Retry' },

    // ── Onboarding ────────────────────────────────────────────────────────────────────
    'onboarding.title': { en: 'Welcome', hi: 'स्वागत है' },
    'onboarding.selectExam': { en: 'Choose your exam', hi: 'अपनी परीक्षा चुनें' },
    'onboarding.examJee': { en: 'JEE', hi: 'जेईई' },
    'onboarding.examNeet': { en: 'NEET', hi: 'नीट' },
    'onboarding.targetYear': { en: 'Target year', hi: 'लक्ष्य वर्ष' },
    'onboarding.currentClass': { en: 'Current class', hi: 'वर्तमान कक्षा' },
    'onboarding.fixedCommitments': { en: 'Fixed commitments', hi: 'निश्चित प्रतिबद्धताएं' },
    'onboarding.peakFocusWindows': { en: 'Peak focus hours', hi: 'सर्वोत्तम एकाग्रता समय' },
    // Client-only onboarding additions (not present in the backend copy) — drive the
    // fixed-commitments editor and the peak-window / weekday labels on the onboarding screen.
    'onboarding.currentClassPlaceholder': { en: 'e.g. Class 12', hi: 'उदा. कक्षा 12' },
    'onboarding.fixedCommitmentsCaption': {
        en: 'Optional — add recurring blocks when you cannot study (school, coaching, sleep).',
        hi: 'वैकल्पिक — वे नियमित समय जोड़ें जब आप अध्ययन नहीं कर सकते (स्कूल, कोचिंग, नींद)।',
    },
    'onboarding.peakFocusWindowsCaption': {
        en: 'Optional — pick the times you focus best.',
        hi: 'वैकल्पिक — वे समय चुनें जब आपकी एकाग्रता सर्वोत्तम होती है।',
    },
    'onboarding.commitmentLabel': { en: 'Label', hi: 'नाम' },
    'onboarding.commitmentLabelPlaceholder': { en: 'e.g. School', hi: 'उदा. स्कूल' },
    'onboarding.commitmentStart': { en: 'Start (HH:mm)', hi: 'आरंभ (HH:mm)' },
    'onboarding.commitmentEnd': { en: 'End (HH:mm)', hi: 'समाप्ति (HH:mm)' },
    'onboarding.commitmentDay': { en: 'Day', hi: 'दिन' },
    'onboarding.addCommitment': { en: 'Add commitment', hi: 'प्रतिबद्धता जोड़ें' },
    'onboarding.remove': { en: 'Remove', hi: 'हटाएं' },
    'onboarding.saveError': {
        en: 'Could not save. Please try again.',
        hi: 'सहेजा नहीं जा सका। कृपया पुनः प्रयास करें।',
    },
    'onboarding.peakMorning': { en: 'Morning', hi: 'सुबह' },
    'onboarding.peakAfternoon': { en: 'Afternoon', hi: 'दोपहर' },
    'onboarding.peakNight': { en: 'Night', hi: 'रात' },
    'onboarding.day.sun': { en: 'Sun', hi: 'रवि' },
    'onboarding.day.mon': { en: 'Mon', hi: 'सोम' },
    'onboarding.day.tue': { en: 'Tue', hi: 'मंगल' },
    'onboarding.day.wed': { en: 'Wed', hi: 'बुध' },
    'onboarding.day.thu': { en: 'Thu', hi: 'गुरु' },
    'onboarding.day.fri': { en: 'Fri', hi: 'शुक्र' },
    'onboarding.day.sat': { en: 'Sat', hi: 'शनि' },

    // ── Timetable ─────────────────────────────────────────────────────────────────────
    'timetable.title': { en: 'Timetable', hi: 'समय सारिणी' },
    'timetable.generate': { en: 'Generate timetable', hi: 'समय सारिणी बनाएं' },
    'timetable.bufferSlot': { en: 'Buffer slot', hi: 'बफर स्लॉट' },
    'timetable.markMissed': { en: 'Mark as missed', hi: 'छूटा हुआ चिह्नित करें' },
    'timetable.overlapError': {
        en: 'This block overlaps another block or a fixed commitment.',
        hi: 'यह ब्लॉक किसी अन्य ब्लॉक या निश्चित प्रतिबद्धता से टकराता है।',
    },
    'timetable.empty': {
        en: 'No blocks for this week. Generate a timetable to begin.',
        hi: 'इस सप्ताह के लिए कोई ब्लॉक नहीं। शुरू करने के लिए समय सारिणी बनाएं।',
    },
    'timetable.subject': { en: 'Subject', hi: 'विषय' },
    'timetable.highEnergy': { en: 'High energy', hi: 'उच्च ऊर्जा' },
    'timetable.lowEnergy': { en: 'Low energy', hi: 'कम ऊर्जा' },
    'timetable.outsidePeak': {
        en: 'Scheduled outside peak focus',
        hi: 'सर्वोत्तम एकाग्रता समय के बाहर निर्धारित',
    },
    // Buffer policy (Req 15.4)
    'timetable.bufferPolicy': { en: 'Unused buffer converts to', hi: 'अप्रयुक्त बफर बदलेगा' },
    'timetable.bufferPolicy.catchUp': { en: 'Catch-up', hi: 'कैच-अप' },
    'timetable.bufferPolicy.extraRevision': { en: 'Extra revision', hi: 'अतिरिक्त पुनरावृत्ति' },
    'timetable.bufferPolicyError': {
        en: 'Could not update the buffer policy.',
        hi: 'बफर नीति अपडेट नहीं हो सकी।',
    },
    // Calendar events (Req 16.1)
    'timetable.addEvent': { en: 'Add event', hi: 'इवेंट जोड़ें' },
    'timetable.event.type': { en: 'Type', hi: 'प्रकार' },
    'timetable.event.startDate': { en: 'Start date', hi: 'आरंभ तिथि' },
    'timetable.event.endDate': { en: 'End date', hi: 'समाप्ति तिथि' },
    'timetable.event.schoolExam': { en: 'School exam', hi: 'स्कूल परीक्षा' },
    'timetable.event.holiday': { en: 'Holiday', hi: 'छुट्टी' },
    'timetable.event.mockTest': { en: 'Mock test', hi: 'मॉक टेस्ट' },
    'timetable.event.dateFormatError': {
        en: 'Enter dates as YYYY-MM-DD.',
        hi: 'तिथियां YYYY-MM-DD के रूप में दर्ज करें।',
    },
    // Holiday sprint offer (Req 16.6)
    'timetable.holidaySprint.title': {
        en: 'Holiday study sprint available',
        hi: 'छुट्टी अध्ययन स्प्रिंट उपलब्ध',
    },
    'timetable.holidaySprint.summary': {
        en: 'A holiday is coming up. Intensify your plan for these days.',
        hi: 'छुट्टी आने वाली है। इन दिनों के लिए अपनी योजना तेज़ करें।',
    },
    'timetable.holidaySprint.suggestedDaily': {
        en: 'Suggested daily study',
        hi: 'सुझाया गया दैनिक अध्ययन',
    },
    'timetable.holidaySprint.hours': { en: 'hours/day', hi: 'घंटे/दिन' },
    'timetable.startTime': { en: 'Start time (ISO)', hi: 'आरंभ समय (ISO)' },
    'timetable.durationMin': { en: 'Duration (minutes)', hi: 'अवधि (मिनट)' },
    'timetable.subjectId': { en: 'Subject id', hi: 'विषय आईडी' },

    // ── Focus timer ───────────────────────────────────────────────────────────────────
    'focus.title': { en: 'Focus timer', hi: 'एकाग्रता टाइमर' },
    'focus.start': { en: 'Start', hi: 'शुरू करें' },
    'focus.pause': { en: 'Pause', hi: 'रोकें' },
    'focus.stop': { en: 'Stop', hi: 'समाप्त करें' },
    'focus.selectSubject': { en: 'Select a subject to begin', hi: 'शुरू करने के लिए विषय चुनें' },
    'focus.sessionType.newChapter': { en: 'New chapter', hi: 'नया अध्याय' },
    'focus.sessionType.practiceProblems': { en: 'Practice problems', hi: 'अभ्यास प्रश्न' },
    'focus.sessionType.revision': { en: 'Revision', hi: 'पुनरावृत्ति' },

    // ── Progress dashboard ──────────────────────────────────────────────────────────────
    'dashboard.title': { en: 'Progress', hi: 'प्रगति' },
    'dashboard.streak': { en: 'Streak', hi: 'निरंतरता' },
    'dashboard.studyTimeToday': { en: "Today's study time", hi: 'आज का अध्ययन समय' },
    'dashboard.studyTimeWeek': { en: "This week's study time", hi: 'इस सप्ताह का अध्ययन समय' },
    'dashboard.syllabusCompletion': { en: 'Syllabus completion', hi: 'पाठ्यक्रम पूर्णता' },

    // ── PYQ practice ──────────────────────────────────────────────────────────────────
    'pyq.title': { en: 'Previous year questions', hi: 'पिछले वर्ष के प्रश्न' },
    'pyq.filterByYear': { en: 'Filter by year', hi: 'वर्ष के अनुसार छाँटें' },
    'pyq.filterBySubject': { en: 'Filter by subject', hi: 'विषय के अनुसार छाँटें' },
    'pyq.submit': { en: 'Submit answers', hi: 'उत्तर जमा करें' },
    'pyq.score': { en: 'Score', hi: 'अंक' },

    // ── Mistake journal ─────────────────────────────────────────────────────────────────
    'mistakes.title': { en: 'Mistake journal', hi: 'गलती डायरी' },
    'mistakes.category.silly': { en: 'Silly mistake', hi: 'लापरवाही की गलती' },
    'mistakes.category.conceptGap': { en: 'Concept gap', hi: 'अवधारणा की कमी' },
    'mistakes.category.timePressure': { en: 'Time pressure', hi: 'समय का दबाव' },
    'mistakes.category.neverSeen': { en: 'Never seen this', hi: 'पहले कभी नहीं देखा' },
    'mistakes.addNote': { en: 'Add a note', hi: 'एक टिप्पणी जोड़ें' },

    // ── AI notes summarizer ─────────────────────────────────────────────────────────────
    'ai.title': { en: 'AI notes', hi: 'एआई नोट्स' },
    'ai.summarizeText': { en: 'Summarize text', hi: 'पाठ का सारांश बनाएं' },
    'ai.summarizePhoto': { en: 'Summarize photo', hi: 'फ़ोटो का सारांश बनाएं' },
    'ai.remainingQuota': { en: 'Remaining summaries', hi: 'शेष सारांश' },
    'ai.emptyInputError': {
        en: 'Enter some note text to summarize.',
        hi: 'सारांश बनाने के लिए कुछ नोट्स दर्ज करें।',
    },

    // ── Paywall / subscription ──────────────────────────────────────────────────────────
    'paywall.title': { en: 'Upgrade to Paid', hi: 'पेड में अपग्रेड करें' },
    'paywall.upgradeCta': { en: 'Upgrade now', hi: 'अभी अपग्रेड करें' },
    'paywall.upgradeRequired': {
        en: 'AI notes are a Paid feature. Upgrade to continue.',
        hi: 'एआई नोट्स एक पेड सुविधा है। जारी रखने के लिए अपग्रेड करें।',
    },
    'paywall.quotaExceeded': {
        en: "You've used all your AI summaries for now.",
        hi: 'आपने अभी के लिए अपने सभी एआई सारांश उपयोग कर लिए हैं।',
    },
    // Intentionally missing `hi` — exercises the English fallback (Req 10.3).
    'paywall.restorePurchase': { en: 'Restore purchase' },

    // ── NTA update feed ─────────────────────────────────────────────────────────────────
    'nta.title': { en: 'NTA updates', hi: 'एनटीए अपडेट' },
    'nta.empty': { en: 'No announcements yet.', hi: 'अभी तक कोई घोषणा नहीं।' },
    'nta.examDateChanged': { en: 'Exam date updated', hi: 'परीक्षा तिथि अपडेट हुई' },
    'nta.loadError': {
        en: 'Could not load the NTA feed.',
        hi: 'एनटीए फ़ीड लोड नहीं हो सका।',
    },

    // ── Auth (client-only additions; not present in the backend copy) ───────────────────
    'auth.login': { en: 'Log in', hi: 'लॉग इन करें' },
    'auth.register': { en: 'Create account', hi: 'खाता बनाएं' },
    'auth.email': { en: 'Email', hi: 'ईमेल' },
    'auth.password': { en: 'Password', hi: 'पासवर्ड' },
    'auth.logout': { en: 'Log out', hi: 'लॉग आउट करें' },
    'auth.needAccount': { en: 'Need an account? Create one', hi: 'खाता चाहिए? एक बनाएं' },
    'auth.haveAccount': { en: 'Already have an account? Log in', hi: 'पहले से खाता है? लॉग इन करें' },
    'auth.missingFields': {
        en: 'Enter your email and password.',
        hi: 'अपना ईमेल और पासवर्ड दर्ज करें।',
    },
    'auth.genericError': {
        en: 'Something went wrong. Check your connection and try again.',
        hi: 'कुछ गलत हो गया। अपना कनेक्शन जांचें और पुनः प्रयास करें।',
    },

    // ── Progress dashboard (client-only additions; task 21.5) ───────────────────────────
    'dashboard.loadError': {
        en: 'Could not load your dashboard.',
        hi: 'आपका डैशबोर्ड लोड नहीं हो सका।',
    },
    'dashboard.noSessionsToday': { en: 'No sessions yet today.', hi: 'आज अभी तक कोई सत्र नहीं।' },
    'dashboard.noSessionsWeek': {
        en: 'No sessions yet this week.',
        hi: 'इस सप्ताह अभी तक कोई सत्र नहीं।',
    },
    'dashboard.velocity': { en: 'Velocity', hi: 'गति' },
    'dashboard.velocityStatus': { en: 'Status', hi: 'स्थिति' },
    'dashboard.velocityAhead': { en: 'Ahead', hi: 'आगे' },
    'dashboard.velocityBehind': { en: 'Behind', hi: 'पीछे' },
    'dashboard.targetCompletion': { en: 'Target completion', hi: 'लक्ष्य पूर्णता' },
    'dashboard.projectedCompletion': { en: 'Projected completion', hi: 'अनुमानित पूर्णता' },
    'dashboard.dayDelta': { en: 'Day delta', hi: 'दिनों का अंतर' },
    'dashboard.daysUnit': { en: 'days', hi: 'दिन' },
    'dashboard.chapters': { en: 'Chapters', hi: 'अध्याय' },
    'dashboard.noChapters': { en: 'No chapters yet.', hi: 'अभी तक कोई अध्याय नहीं।' },
    'dashboard.chapterStatusError': {
        en: 'Could not update the chapter. Status only moves forward.',
        hi: 'अध्याय अपडेट नहीं हो सका। स्थिति केवल आगे बढ़ती है।',
    },

    // ── Chapter status labels (client-only additions; task 21.5, Req 12.1) ──────────────
    'chapter.status.notStarted': { en: 'Not started', hi: 'शुरू नहीं हुआ' },
    'chapter.status.inProgress': { en: 'In progress', hi: 'प्रगति में' },
    'chapter.status.done': { en: 'Done', hi: 'पूर्ण' },
    'chapter.status.revised': { en: 'Revised', hi: 'पुनरावलोकित' },

    // ── Daily check-in (client-only additions; task 21.5, Req 14.1) ─────────────────────
    'checkin.title': { en: 'Daily check-in', hi: 'दैनिक चेक-इन' },
    'checkin.hint': {
        en: "Log today's planned study time. Leave actual blank to use your focus sessions.",
        hi: 'आज का नियोजित अध्ययन समय दर्ज करें। फोकस सत्रों का उपयोग करने के लिए वास्तविक खाली छोड़ें।',
    },
    'checkin.plannedLabel': { en: 'Planned minutes', hi: 'नियोजित मिनट' },
    'checkin.actualLabel': { en: 'Actual minutes (optional)', hi: 'वास्तविक मिनट (वैकल्पिक)' },
    'checkin.plannedPlaceholder': { en: 'e.g. 180', hi: 'उदा. 180' },
    'checkin.actualPlaceholder': {
        en: 'Leave blank to use focus sessions',
        hi: 'फोकस सत्र उपयोग करने हेतु खाली छोड़ें',
    },
    'checkin.plannedError': {
        en: 'Enter planned minutes as a whole number (e.g. 180).',
        hi: 'नियोजित मिनट एक पूर्ण संख्या के रूप में दर्ज करें (उदा. 180)।',
    },
    'checkin.actualError': {
        en: 'Actual minutes must be a whole number, or left blank.',
        hi: 'वास्तविक मिनट एक पूर्ण संख्या होनी चाहिए, या खाली छोड़ें।',
    },
    'checkin.saveError': {
        en: 'Could not save your check-in. Please try again.',
        hi: 'आपका चेक-इन सहेजा नहीं जा सका। कृपया पुनः प्रयास करें।',
    },
    'checkin.saved': { en: 'Saved', hi: 'सहेजा गया' },
    'checkin.saveButton': { en: 'Save check-in', hi: 'चेक-इन सहेजें' },
} as const satisfies StringCatalog;

/** The union of every known string key in the shipped catalog. */
export type StringKey = keyof typeof stringCatalog;

/** Type guard: narrows an arbitrary string to a known catalog key. */
export function isStringKey(key: string): key is StringKey {
    return Object.prototype.hasOwnProperty.call(stringCatalog, key);
}

// Re-export for convenience so consumers can import the value type alongside the catalog.
export type { LocalizedString };
