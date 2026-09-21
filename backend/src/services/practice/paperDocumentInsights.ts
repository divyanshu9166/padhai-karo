import type { ExamProgram } from '@prisma/client';

export interface PaperDocumentInsights {
    source: 'EXTRACTED_TEXT' | 'UNAVAILABLE';
    detectedTopics: Array<{ label: string; evidenceCount: number }>;
    estimatedQuestionCount: number | null;
    coverage: 'NONE' | 'LIMITED' | 'GOOD';
    message: string;
    limitation: string;
}

const CATALOG: Record<'UPSC_CSE' | 'SSC_CGL', ReadonlyArray<{ label: string; terms: readonly string[] }>> = {
    UPSC_CSE: [
        { label: 'Polity and Governance', terms: ['constitution', 'parliament', 'governance', 'fundamental right', 'panchayat'] },
        { label: 'History and Culture', terms: ['history', 'movement', 'empire', 'culture', 'civilization'] },
        { label: 'Geography', terms: ['geography', 'river', 'monsoon', 'climate', 'soil'] },
        { label: 'Economy', terms: ['economy', 'inflation', 'fiscal', 'monetary', 'gdp', 'banking'] },
        { label: 'Environment', terms: ['biodiversity', 'ecosystem', 'environment', 'species', 'conservation'] },
        { label: 'Science and Technology', terms: ['technology', 'space', 'biotechnology', 'science', 'digital'] },
        { label: 'CSAT', terms: ['comprehension', 'reasoning', 'numeracy', 'data interpretation', 'decision making'] },
    ],
    SSC_CGL: [
        { label: 'Quantitative Aptitude', terms: ['percentage', 'ratio', 'profit', 'algebra', 'geometry', 'mensuration', 'trigonometry'] },
        { label: 'Reasoning', terms: ['analogy', 'series', 'coding', 'syllogism', 'venn', 'classification'] },
        { label: 'English', terms: ['grammar', 'synonym', 'antonym', 'comprehension', 'sentence', 'idiom'] },
        { label: 'General Awareness', terms: ['history', 'geography', 'polity', 'economy', 'current affairs', 'science'] },
        { label: 'Computer Knowledge', terms: ['computer', 'operating system', 'internet', 'network', 'cyber', 'spreadsheet'] },
        { label: 'Statistics', terms: ['mean', 'median', 'dispersion', 'correlation', 'regression', 'probability'] },
    ],
};

function occurrences(haystack: string, needle: string): number {
    if (!needle) return 0;
    let count = 0; let start = 0;
    while ((start = haystack.indexOf(needle, start)) >= 0) { count += 1; start += needle.length; }
    return count;
}

/** Content-only inspection. Correctness still requires answer data or an official key. */
export function analysePaperDocumentText(text: string | null | undefined, program: ExamProgram | null): PaperDocumentInsights {
    const normalized = (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.length < 80) return {
        source: 'UNAVAILABLE', detectedTopics: [], estimatedQuestionCount: null, coverage: 'NONE',
        message: 'The attachment has too little extractable text for reliable topic detection.',
        limitation: 'Upload a text-readable PDF, or enter section scores manually. Scanned pages need OCR/vision processing.',
    };
    const key = program === 'SSC_CGL' ? 'SSC_CGL' : 'UPSC_CSE';
    const detectedTopics = CATALOG[key]
        .map((topic) => ({ label: topic.label, evidenceCount: topic.terms.reduce((sum, term) => sum + occurrences(normalized, term), 0) }))
        .filter((topic) => topic.evidenceCount > 0)
        .sort((a, b) => b.evidenceCount - a.evidenceCount)
        .slice(0, 6);
    const numbered = [...normalized.matchAll(/(?:^|\s)(?:q(?:uestion)?\s*)?(\d{1,3})[.)]\s/gi)].map((match) => Number(match[1])).filter((value) => value > 0 && value <= 250);
    const estimatedQuestionCount = numbered.length >= 3 ? new Set(numbered).size : null;
    const evidence = detectedTopics.reduce((sum, topic) => sum + topic.evidenceCount, 0);
    return {
        source: 'EXTRACTED_TEXT', detectedTopics, estimatedQuestionCount,
        coverage: evidence >= 12 ? 'GOOD' : detectedTopics.length > 0 ? 'LIMITED' : 'NONE',
        message: detectedTopics.length > 0
            ? `Detected ${detectedTopics.length} likely study area${detectedTopics.length === 1 ? '' : 's'} from the attached paper text.`
            : 'The paper text was readable, but no UPSC/SSC topic could be identified confidently.',
        limitation: 'Topic detection reads paper content only. It cannot judge which answers were correct without an answer sheet or official key.',
    };
}
