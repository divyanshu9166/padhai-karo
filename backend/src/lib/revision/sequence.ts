/** The visible chapter sequence used by the planner and revision calendar. */
export const REVISION_SEQUENCE = [
    { phase: 'FIRST_STUDY', label: 'First Study', offsetDays: 0 },
    { phase: 'REVISION_1', label: 'Revision 1', offsetDays: 1 },
    { phase: 'REVISION_2', label: 'Revision 2', offsetDays: 3 },
    { phase: 'FINAL_REVISION', label: 'Final Revision', offsetDays: 7 },
    { phase: 'LONG_TERM', label: 'Long-term Revision', offsetDays: 21 },
] as const;

export type RevisionPhase = (typeof REVISION_SEQUENCE)[number]['phase'];

export function addUtcDays(base: Date, days: number): Date {
    const result = new Date(base);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

export function phaseForOffset(offsetDays: number): (typeof REVISION_SEQUENCE)[number] {
    return REVISION_SEQUENCE.find((item) => item.offsetDays === offsetDays) ?? REVISION_SEQUENCE[0];
}
