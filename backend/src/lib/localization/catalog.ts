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

    // ── Performance Analytics (Phase 2, Req 15) ─────────────────────────────────────────
    // All new user-facing analytics labels/messages. Every key carries `en`; `hi` is
    // provided for all entries (the resolver still falls back to English for any gap).
    'analytics.title': { en: 'Performance analytics', hi: 'प्रदर्शन विश्लेषण' },

    // External mock source names (Req 1)
    'analytics.mockSource.allen': { en: 'Allen', hi: 'एलन' },
    'analytics.mockSource.aakash': { en: 'Aakash', hi: 'आकाश' },
    'analytics.mockSource.other': { en: 'Other', hi: 'अन्य' },
    'analytics.mockScore.title': { en: 'External mock scores', hi: 'बाहरी मॉक अंक' },
    'analytics.mockScore.add': { en: 'Add mock score', hi: 'मॉक अंक जोड़ें' },
    'analytics.mockScore.source': { en: 'Test series', hi: 'टेस्ट श्रृंखला' },
    'analytics.mockScore.sourceName': { en: 'Series name', hi: 'श्रृंखला का नाम' },
    'analytics.mockScore.testDate': { en: 'Test date', hi: 'परीक्षा तिथि' },
    'analytics.mockScore.obtainedScore': { en: 'Score obtained', hi: 'प्राप्त अंक' },
    'analytics.mockScore.maxScore': { en: 'Maximum score', hi: 'अधिकतम अंक' },

    // Score trajectory / axis labels (Req 2)
    'analytics.trajectory.title': { en: 'Score trajectory', hi: 'स्कोर प्रगति' },
    'analytics.trajectory.axisDate': { en: 'Date', hi: 'तिथि' },
    'analytics.trajectory.axisScore': { en: 'Score (%)', hi: 'अंक (%)' },
    'analytics.trajectory.empty': {
        en: 'No score data yet. Add a mock score or complete a practice attempt to see your trajectory.',
        hi: 'अभी तक कोई स्कोर डेटा नहीं। अपनी प्रगति देखने के लिए मॉक अंक जोड़ें या एक अभ्यास प्रयास पूरा करें।',
    },
    'analytics.source.externalMock': { en: 'External mock', hi: 'बाहरी मॉक' },
    'analytics.source.pyqAttempt': { en: 'PYQ attempt', hi: 'पीवाईक्यू प्रयास' },
    'analytics.source.timedPaper': { en: 'Timed paper', hi: 'समयबद्ध पेपर' },

    // Rank / percentile / score-range prediction (Req 3)
    'analytics.rank.title': { en: 'Rank prediction', hi: 'रैंक अनुमान' },
    'analytics.rank.jeePercentile': { en: 'Estimated JEE percentile', hi: 'अनुमानित जेईई पर्सेंटाइल' },
    'analytics.rank.neetScoreRange': { en: 'Estimated NEET score range', hi: 'अनुमानित नीट अंक सीमा' },
    'analytics.rank.estimateRange': { en: 'Estimated range', hi: 'अनुमानित सीमा' },
    'analytics.rank.referenceYear': { en: 'Based on reference data year', hi: 'संदर्भ डेटा वर्ष पर आधारित' },
    'analytics.rank.unit.percentile': { en: 'Percentile', hi: 'पर्सेंटाइल' },
    'analytics.rank.unit.marks': { en: 'Marks', hi: 'अंक' },
    'analytics.rank.unit.rank': { en: 'Rank', hi: 'रैंक' },

    // Target cutoff selection & score-improvement gap (Req 4, 5)
    'analytics.targetCutoff.title': { en: 'Target college cutoff', hi: 'लक्ष्य कॉलेज कटऑफ' },
    'analytics.targetCutoff.select': { en: 'Select target cutoff', hi: 'लक्ष्य कटऑफ चुनें' },
    'analytics.cutoff.college': { en: 'College', hi: 'कॉलेज' },
    'analytics.cutoff.branch': { en: 'Branch', hi: 'शाखा' },
    'analytics.cutoff.category': { en: 'Category', hi: 'श्रेणी' },
    'analytics.cutoff.closingValue': { en: 'Closing value', hi: 'समापन मान' },
    'analytics.scoreGap.title': { en: 'Improvement gap', hi: 'सुधार अंतर' },
    'analytics.scoreGap.needed': { en: 'Improvement needed', hi: 'आवश्यक सुधार' },
    'analytics.scoreGap.met': { en: 'Target met', hi: 'लक्ष्य पूरा हुआ' },
    'analytics.scoreGap.margin': { en: 'Margin above target', hi: 'लक्ष्य से ऊपर अंतर' },

    // Topic trend analysis (Req 7)
    'analytics.topicTrend.title': { en: 'Topic trends', hi: 'विषय रुझान' },
    'analytics.topicTrend.appearanceCount': { en: 'Appearances', hi: 'उपस्थिति संख्या' },
    'analytics.topicTrend.avgPerYear': { en: 'Avg questions per year', hi: 'प्रति वर्ष औसत प्रश्न' },
    'analytics.topicTrend.yearSpan': { en: 'Years covered', hi: 'सम्मिलित वर्ष' },
    'analytics.topicTrend.noData': { en: 'No historical frequency data', hi: 'कोई ऐतिहासिक आवृत्ति डेटा नहीं' },

    // Topic prioritization (Req 8)
    'analytics.topicPriority.title': { en: 'Topic priority', hi: 'विषय प्राथमिकता' },
    'analytics.topicPriority.score': { en: 'Priority', hi: 'प्राथमिकता' },
    'analytics.topicPriority.highFrequency': { en: 'High frequency', hi: 'उच्च आवृत्ति' },
    'analytics.topicPriority.weakArea': { en: 'Weak area', hi: 'कमज़ोर क्षेत्र' },
    'analytics.topicPriority.highFreqAndWeak': {
        en: 'High-frequency and weak',
        hi: 'उच्च आवृत्ति और कमज़ोर',
    },

    // Attempt quality metrics (Req 9, 10)
    'analytics.quality.title': { en: 'Attempt quality', hi: 'प्रयास गुणवत्ता' },
    'analytics.quality.accuracy': { en: 'Accuracy (%)', hi: 'सटीकता (%)' },
    'analytics.quality.avgTimePerQuestion': { en: 'Avg time per question', hi: 'प्रति प्रश्न औसत समय' },
    'analytics.quality.avgTimeUnavailable': { en: 'Time not recorded', hi: 'समय दर्ज नहीं' },
    'analytics.quality.unattempted': { en: 'Unattempted', hi: 'अनुत्तरित' },
    'analytics.quality.attemptRate': { en: 'Attempt rate (%)', hi: 'प्रयास दर (%)' },
    'analytics.quality.trendTitle': { en: 'Attempt quality trend', hi: 'प्रयास गुणवत्ता रुझान' },
    'analytics.quality.direction.increased': { en: 'Increased', hi: 'बढ़ा' },
    'analytics.quality.direction.decreased': { en: 'Decreased', hi: 'घटा' },
    'analytics.quality.direction.unchanged': { en: 'Unchanged', hi: 'अपरिवर्तित' },

    // Weak-area detection & ranking (Req 11, 12)
    'analytics.weakArea.title': { en: 'Weak areas', hi: 'कमज़ोर क्षेत्र' },
    'analytics.weakArea.score': { en: 'Weak-area score', hi: 'कमज़ोर क्षेत्र अंक' },
    'analytics.weakArea.level.subject': { en: 'Subject', hi: 'विषय' },
    'analytics.weakArea.level.chapter': { en: 'Chapter', hi: 'अध्याय' },
    'analytics.weakArea.level.topic': { en: 'Topic', hi: 'प्रकरण' },
    'analytics.weakArea.incorrectCount': { en: 'Incorrect answers', hi: 'गलत उत्तर' },
    'analytics.weakArea.sessionTimeDistribution': {
        en: 'Study time by session type',
        hi: 'सत्र प्रकार अनुसार अध्ययन समय',
    },

    // Session-type labels surfaced by weak-area analytics not present in the Phase 1
    // catalog (New Chapter / Practice Problems / Revision reuse `focus.sessionType.*`).
    'analytics.sessionType.mockAnalysis': { en: 'Mock analysis', hi: 'मॉक विश्लेषण' },
    'analytics.sessionType.formulaDrill': { en: 'Formula drill', hi: 'सूत्र अभ्यास' },

    // Shared insufficient-data, reference-unavailable, and target-required messages
    'analytics.insufficientData.rankPrediction': {
        en: 'Not enough score data yet to estimate your standing.',
        hi: 'आपकी स्थिति का अनुमान लगाने के लिए अभी पर्याप्त स्कोर डेटा नहीं है।',
    },
    'analytics.insufficientData.qualityTrend': {
        en: 'At least two attempts are needed to show a change in attempt quality.',
        hi: 'प्रयास गुणवत्ता में बदलाव दिखाने के लिए कम से कम दो प्रयास आवश्यक हैं।',
    },
    'analytics.referenceUnavailable': {
        en: 'Reference data is not available for your exam yet.',
        hi: 'आपकी परीक्षा के लिए अभी संदर्भ डेटा उपलब्ध नहीं है।',
    },
    'analytics.targetCutoffRequired': {
        en: 'Select a target college cutoff to see your improvement gap.',
        hi: 'अपना सुधार अंतर देखने के लिए एक लक्ष्य कॉलेज कटऑफ चुनें।',
    },

    // ── Weightage-Based Time Allocation (Phase 2, Req 11) ───────────────────────────────
    // All new user-facing allocation labels/messages. Every key carries a non-empty `en`
    // and a non-empty `hi` value (Req 11.4); the resolver still falls back to English for
    // any gap and for unsupported languages (Req 11.2, 11.3).
    'allocation.title': { en: 'Time allocation', hi: 'समय आवंटन' },
    'allocation.referenceYear': {
        en: 'Based on reference data year',
        hi: 'संदर्भ डेटा वर्ष पर आधारित',
    },

    // Most-frequent chapters (Req 4)
    'allocation.mostFrequent.title': { en: 'Most-frequent chapters', hi: 'सर्वाधिक बार आने वाले अध्याय' },
    'allocation.mostFrequent.subtitle': {
        en: 'Chapters that appear most often across your practice and past papers',
        hi: 'आपके अभ्यास और पिछले प्रश्नपत्रों में सबसे अधिक आने वाले अध्याय',
    },
    'allocation.mostFrequent.empty': {
        en: 'No chapters yet. Add chapters to see your most-frequent ones.',
        hi: 'अभी तक कोई अध्याय नहीं। अपने सर्वाधिक बार आने वाले अध्याय देखने के लिए अध्याय जोड़ें।',
    },

    // Combined-signal component labels (Req 3, 4.2)
    'allocation.signal.pyqFrequency': { en: 'Your PYQ practice', hi: 'आपका पीवाईक्यू अभ्यास' },
    'allocation.signal.historicalFrequency': { en: 'Historical frequency', hi: 'ऐतिहासिक आवृत्ति' },
    'allocation.signal.combined': { en: 'Priority signal', hi: 'प्राथमिकता संकेत' },
    // Fallback / "no historical data" label (Req 2.3, 2.4)
    'allocation.signal.noHistoricalData': {
        en: 'No historical frequency data',
        hi: 'कोई ऐतिहासिक आवृत्ति डेटा नहीं',
    },

    // Suggested time allocation (Req 5, 6)
    'allocation.suggested.title': { en: 'Suggested time allocation', hi: 'सुझाया गया समय आवंटन' },
    'allocation.suggested.subtitle': {
        en: 'How to split your study time across pending chapters',
        hi: 'अपने अध्ययन समय को लंबित अध्यायों में कैसे बाँटें',
    },
    'allocation.suggested.share': { en: 'Allocation share', hi: 'आवंटन हिस्सा' },
    'allocation.suggested.empty': {
        en: 'No pending chapters to allocate time to.',
        hi: 'समय आवंटित करने के लिए कोई लंबित अध्याय नहीं।',
    },
    // Allocation-share source labels (Req 6.2)
    'allocation.suggested.source.suggested': {
        en: 'Based on priority signal',
        hi: 'प्राथमिकता संकेत पर आधारित',
    },
    'allocation.suggested.source.weightageFallback': {
        en: 'Based on default weightage',
        hi: 'डिफ़ॉल्ट वेटेज पर आधारित',
    },
    // Default-weightage flag label (Req 6.3)
    'allocation.suggested.defaultWeightage': { en: 'Default weightage', hi: 'डिफ़ॉल्ट वेटेज' },

    // Effective allocation mode labels (Req 7)
    'allocation.mode.title': { en: 'Allocation mode', hi: 'आवंटन मोड' },
    'allocation.mode.suggested': { en: 'Use suggested allocation', hi: 'सुझाया गया आवंटन उपयोग करें' },
    'allocation.mode.phase1Default': {
        en: 'Use default weightage allocation',
        hi: 'डिफ़ॉल्ट वेटेज आवंटन उपयोग करें',
    },

    // Reference-data-unavailable message (Req 2.4, 3.7, 9.5)
    'allocation.referenceUnavailable': {
        en: 'Reference data is not available for your exam yet, so allocation guidance cannot be computed.',
        hi: 'आपकी परीक्षा के लिए अभी संदर्भ डेटा उपलब्ध नहीं है, इसलिए आवंटन मार्गदर्शन की गणना नहीं की जा सकती।',
    },
} as const satisfies StringCatalog;

/** The union of every known string key in the shipped catalog. */
export type StringKey = keyof typeof stringCatalog;

/** Type guard: narrows an arbitrary string to a known catalog key. */
export function isStringKey(key: string): key is StringKey {
    return Object.prototype.hasOwnProperty.call(stringCatalog, key);
}

// Re-export for convenience so consumers can import the value type alongside the catalog.
export type { LocalizedString };
