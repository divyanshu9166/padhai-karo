/**
 * Mistake Journal service public surface (task 14.1, Req 18).
 *
 * Re-exports the route handlers consumed by the thin Next.js route files under
 * `src/app/api/mistakes`, plus the pure validation / flag-decision / filter helpers so they
 * can be unit-tested and reused.
 */
export {
    flagMistakeHandler,
    listMistakesHandler,
    deleteMistakeHandler,
} from './mistakeService';
export type { MistakeRouteContext } from './mistakeService';

export {
    MISTAKE_CATEGORIES,
    MISTAKE_SOURCE_TYPES,
    isMistakeCategory,
    isMistakeSourceType,
    validateCategoryFilter,
    validateMistakeFlagInput,
} from './mistakeValidation';
export type {
    MistakeCategoryValue,
    MistakeSourceType,
    MistakeFlagInput,
    MistakeFlagValidation,
    ValidatedMistakeFlag,
} from './mistakeValidation';

export {
    QuestionOutcome,
    decideFlaggable,
    findPerQuestion,
    readPerQuestion,
    resolveSubmittedAnswer,
} from './flagDecision';
export type { FlagDecision, PerQuestionRecord } from './flagDecision';

export { MISTAKE_LIST_ORDER_BY, buildMistakeWhere } from './filter';
export type { MistakeFilterCriteria, MistakeWhere } from './filter';
