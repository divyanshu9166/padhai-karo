export type CurrentAffairsFeedItem = {
    examProgram?: 'UPSC_CSE' | 'SSC_CGL';
    title: string;
    summary: string;
    body?: string;
    category: string;
    tags?: string[];
    sourceName: string;
    sourceUrl: string;
    publishedAt: Date;
};
