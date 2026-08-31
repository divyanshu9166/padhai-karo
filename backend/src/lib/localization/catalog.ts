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
    'onboarding.examUpsc': { en: 'UPSC CSE', hi: 'यूपीएससी सीएसई' },
    'onboarding.examSsc': { en: 'SSC CGL', hi: 'एसएससी सीजीएल' },
    'onboarding.selectStage': { en: 'Choose your stage', hi: 'अपना चरण चुनें' },
    'onboarding.stagePrelims': { en: 'Prelims', hi: 'प्रारंभिक परीक्षा' },
    'onboarding.stageMains': { en: 'Mains', hi: 'मुख्य परीक्षा' },
    'onboarding.stageTier1': { en: 'Tier 1', hi: 'टियर 1' },
    'onboarding.stageTier2': { en: 'Tier 2', hi: 'टियर 2' },
    'onboarding.targetYear': { en: 'Target year', hi: 'लक्ष्य वर्ष' },
    'onboarding.currentClass': { en: 'Current class', hi: 'वर्तमान कक्षा' },
    'onboarding.studyStatus': { en: 'Study status', hi: 'अध्ययन स्थिति' },
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
    'currentAffairs.title': { en: 'Current affairs', hi: 'समसामयिकी', ta: 'நடப்பு நிகழ்வுகள்', bn: 'সাম্প্রতিক বিষয়', te: 'కరెంట్ అఫైర్స్', mr: 'चालू घडामोडी' },
    'community.title': { en: 'Community', hi: 'समुदाय', ta: 'சமூகம்', bn: 'সম্প্রদায়', te: 'కమ్యూనిటీ', mr: 'समुदాయ' },
    'community.report': { en: 'Report', hi: 'रिपोर्ट करें', ta: 'புகார்', bn: 'রিপোর্ট', te: 'రిపోర్ట్', mr: 'तक्रार' },
    'more.title': { en: 'More', hi: 'अधिक', ta: 'மேலும்', bn: 'আরও', te: 'మరిన్ని', mr: 'अधिक' },
    'practice.timedPaper': { en: 'Timed paper', hi: 'समयबद्ध पेपर', ta: 'நேரக் கேள்வித்தாள்', bn: 'সময়বদ্ধ পেপার', te: 'సమయ పేపర్', mr: 'वेळबद्ध पेपर' },
    'practice.fullMock': { en: 'Full mock', hi: 'पूर्ण मॉक टेस्ट', ta: 'முழு மாதிரி தேர்வு', bn: 'সম্পূর্ণ মক', te: 'పూర్తి మాక్', mr: 'पूर्ण मॉक' },
    'practice.previous': { en: 'Previous', hi: 'पिछला', ta: 'முந்தையது', bn: 'আগের', te: 'మునుపటి', mr: 'मागील' },
    'practice.next': { en: 'Next', hi: 'अगला', ta: 'அடுத்து', bn: 'পরের', te: 'తదుపరి', mr: 'पुढील' },
    'practice.submit': { en: 'Submit', hi: 'जमा करें', ta: 'சமர்ப்பிக்கவும்', bn: 'জমা দিন', te: 'సమర్పించండి', mr: 'सबमिट करा' },
    'common.offline': { en: 'Offline', hi: 'ऑफलाइन', ta: 'ஆஃப்லைன்', bn: 'অফলাইন', te: 'ఆఫ్‌లైన్', mr: 'ऑफलाइन' },
    'common.saveOffline': { en: 'Save for offline reading', hi: 'ऑफलाइन पढ़ने के लिए सहेजें', ta: 'ஆஃப்லைன் வாசிப்புக்குச் சேமிக்கவும்', bn: 'অফলাইনে পড়ার জন্য সংরক্ষণ করুন', te: 'ఆఫ్‌లైన్ చదవడానికి సేవ్ చేయండి', mr: 'ऑफलाइन वाचनासाठी जतन करा' },
    'focus.ambientLabel': { en: 'Ambient sound (optional)', hi: 'एंबिएंट ध्वनि (वैकल्पिक)', ta: 'சுற்றுப்புற ஒலி (விருப்பம்)', bn: 'অ্যাম্বিয়েন্ট শব্দ (ঐচ্ছিক)', te: 'పరిసర ధ్వని (ఐచ్ఛికం)', mr: 'परिसरातील आवाज (पर्यायी)' },
    'focus.ambientNone': { en: 'None', hi: 'कोई नहीं', ta: 'எதுவுமில்லை', bn: 'কোনোটিই নয়', te: 'ఏదీ కాదు', mr: 'काही नाही' },
    'focus.ambientPlaying': { en: 'is playing with this focus session.', hi: 'इस फोकस सत्र के साथ चल रहा है।', ta: 'இந்த கவன அமர்வுடன் ஒலிக்கிறது.', bn: 'এই ফোকাস সেশনের সঙ্গে চলছে।', te: 'ఈ ఫోకస్ సెషన్‌తో ప్లే అవుతోంది.', mr: 'या फोकस सत्रासोबत वाजत आहे.' },
    'focus.ambientUnavailable': { en: 'Ambient sound could not start. Your focus session is still running.', hi: 'एंबिएंट ध्वनि शुरू नहीं हो सकी। आपका फोकस सत्र जारी है।', ta: 'சுற்றுப்புற ஒலியைத் தொடங்க முடியவில்லை. உங்கள் கவன அமர்வு தொடர்கிறது.', bn: 'অ্যাম্বিয়েন্ট শব্দ শুরু করা যায়নি। আপনার ফোকাস সেশন চলছে।', te: 'పరిసర ధ్వని ప్రారంభం కాలేదు. మీ ఫోకస్ సెషన్ కొనసాగుతోంది.', mr: 'परिसरातील आवाज सुरू होऊ शकला नाही. तुमचे फोकस सत्र सुरू आहे.' },
    'library.previousPage': { en: 'Previous', hi: 'पिछला', ta: 'முந்தையது', bn: 'আগের', te: 'మునుపటి', mr: 'मागील' },
    'library.nextPage': { en: 'Next', hi: 'अगला', ta: 'அடுத்து', bn: 'পরের', te: 'తదుపరి', mr: 'पुढील' },
    'library.singlePage': { en: 'Single page', hi: 'एक पृष्ठ', ta: 'ஒற்றைப் பக்கம்', bn: 'এক পৃষ্ঠা', te: 'ఒక పేజీ', mr: 'एक पान' },
    'library.continuousText': { en: 'Continuous text', hi: 'सतत टेक्स्ट', ta: 'தொடர்ச்சியான உரை', bn: 'ধারাবাহিক টেক্সট', te: 'నిరంతర పాఠ్యం', mr: 'सलग मजकूर' },
    'library.searchInside': { en: 'Search inside this PDF', hi: 'इस PDF में खोजें', ta: 'இந்த PDF-இல் தேடவும்', bn: 'এই PDF-এ খুঁজুন', te: 'ఈ PDFలో వెతకండి', mr: 'या PDF मध्ये शोधा' },
    'library.noMatches': { en: 'No text matches found in this PDF.', hi: 'इस PDF में कोई टेक्स्ट मिलान नहीं मिला।', ta: 'இந்த PDF-இல் உரை பொருத்தம் இல்லை.', bn: 'এই PDF-এ কোনো টেক্সট মেলেনি।', te: 'ఈ PDFలో టెక్స్ట్ సరిపోలికలు లేవు.', mr: 'या PDF मध्ये मजकूर जुळला नाही.' },
    'library.goToPage': { en: 'Go to page', hi: 'पृष्ठ पर जाएं', ta: 'பக்கத்திற்குச் செல்லவும்', bn: 'পৃষ্ঠায় যান', te: 'పేజీకి వెళ్లండి', mr: 'पानावर जा' },
    'library.noExtractedText': { en: 'Continuous text is available after the PDF text is extracted.', hi: 'PDF टेक्स्ट निकालने के बाद सतत टेक्स्ट उपलब्ध होगा।', ta: 'PDF உரை எடுக்கப்பட்ட பிறகு தொடர்ச்சியான உரை கிடைக்கும்.', bn: 'PDF টেক্সট এক্সট্রাক্ট হওয়ার পরে ধারাবাহিক টেক্সট পাওয়া যাবে।', te: 'PDF టెక్స్ట్ తీసిన తర్వాత నిరంతర పాఠ్యం అందుబాటులో ఉంటుంది.', mr: 'PDF मजकूर काढल्यानंतर सलग मजकूर उपलब्ध होईल.' },
} as const satisfies StringCatalog;

/** The union of every known string key in the shipped catalog. */
export type StringKey = keyof typeof stringCatalog;

/** Type guard: narrows an arbitrary string to a known catalog key. */
export function isStringKey(key: string): key is StringKey {
    return Object.prototype.hasOwnProperty.call(stringCatalog, key);
}

// Re-export for convenience so consumers can import the value type alongside the catalog.
export type { LocalizedString };
