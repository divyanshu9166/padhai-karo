/**
 * Allocation Service barrel (task 14.1; design "Service layer"; Req 9.1).
 *
 * Re-exports the public surface of the Weightage-Based Time Allocation service layer — the
 * shared `allocationReader` data-access seam and the four endpoint handlers — so the thin
 * `src/app/api/allocation/*` route files can import the handlers from a single module.
 */
export {
    readAllocationData,
    readAllocationProfile,
} from './allocationReader';
export type {
    AllocationData,
    AllocationProfile,
    AllocationReaderChapter,
} from './allocationReader';

export { signalHandler } from './signalService';

export {
    assembleChapterSignals,
    mostFrequentChaptersHandler,
} from './mostFrequentService';

export { suggestedAllocationHandler } from './suggestedAllocationService';

export {
    EFFECTIVE_ALLOCATION_MODE_VALUES,
    getAllocationModeHandler,
    updateAllocationModeHandler,
    validateAllocationModeInput,
} from './modeService';
export type { AllocationModeValidation } from './modeService';
