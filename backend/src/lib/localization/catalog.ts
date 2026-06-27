/**
 * EN/HI localized string catalog (Req 10).
 *
 * A starter set of keyed UI strings spanning the Phase 1 surfaces (onboarding, timetable,
 * focus timer, dashboard, PYQ practice, mistake journal, AI notes, paywall, NTA feed, and
 * common actions). This is intentionally representative rather than exhaustive — the catalog
 * is structured so adding a key is a single self-contained entry.
 *
 * Every entry carries an English (`en`) value; `hi` is provided where a translation exists.
 * A handful of keys deliberately omit `hi` to exercise the English fallback path required by
 * Req 10.3 (see `paywall.restorePurchase` and `common.retry` below).
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

    // ── Timetable ─────────────────────────────────────────────────────────────────────
    'timetable.title': { en: 'Timetable', hi: 'समय सारिणी' },
    'timetable.generate': { en: 'Generate timetable', hi: 'समय सारिणी बनाएं' },
    'timetable.bufferSlot': { en: 'Buffer slot', hi: 'बफर स्लॉट' },
    'timetable.markMissed': { en: 'Mark as missed', hi: 'छूटा हुआ चिह्नित करें' },
    'timetable.overlapError': {
        en: 'This block overlaps another block or a fixed commitment.',
        hi: 'यह ब्लॉक किसी अन्य ब्लॉक या निश्चित प्रतिबद्धता से टकराता है।',
    },

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
} as const satisfies StringCatalog;

/** The union of every known string key in the shipped catalog. */
export type StringKey = keyof typeof stringCatalog;

/** Type guard: narrows an arbitrary string to a known catalog key. */
export function isStringKey(key: string): key is StringKey {
    return Object.prototype.hasOwnProperty.call(stringCatalog, key);
}

// Re-export for convenience so consumers can import the value type alongside the catalog.
export type { LocalizedString };
