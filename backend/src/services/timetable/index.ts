/**
 * Public surface of the Timetable Generation Service (task 6.5; design "Timetable Generation
 * Service"). The route files import the two handlers from here; the pure materialization
 * helpers are re-exported for the property/unit tests (tasks 6.9–6.12).
 */
export {
    generateTimetableHandler,
    getTimetableHandler,
} from './timetableGenerationService';

export {
    deleteBlockHandler,
    editBlockHandler,
} from './blockEditService';
export type { BlockRouteContext } from './blockEditService';

export {
    convertUnusedBuffersHandler,
    missedBlockHandler,
    updateBufferPolicyHandler,
} from './rebalanceService';

export {
    BUFFER_POLICIES,
    MIN_COMPRESSED_BLOCK_MIN,
    compressOtherSubjects,
    convertUnusedBuffers,
    findFillableBuffer,
    isBufferPolicy,
    parseBufferPolicy,
    planRebalance,
} from './rebalance';
export type {
    BufferConversion,
    BufferPolicy,
    Compression,
    RebalanceBlock,
    RebalanceDecision,
} from './rebalance';

export {
    blockConflictsWithCommitment,
    blockToEpochInterval,
    blockToWeekdayWindow,
    blocksConflict,
    intervalsOverlap,
    proposedBlockConflicts,
} from './overlap';
export type { BlockInterval, RecurringCommitment, WeekdayWindow } from './overlap';

export {
    SLOT_HOURS,
    assertNoOverlap,
    buildConcreteSlots,
    materializeTimetable,
    splitStudyAndBuffer,
} from './materialize';
export type {
    MaterializeChapter,
    MaterializeInput,
    MaterializeResult,
    MaterializedBlock,
} from './materialize';
