export {
    PAPER_QUESTION_CLIENT_SELECT,
    buildAnswerKey,
    createTimedAttemptHandler,
    getPaperHandler,
    getTimedAttemptHandler,
    scoreTimedAttempt,
} from './timedPaperAttemptService';
export type {
    ClientPaperQuestion,
    IdRouteContext,
    PaperAnswerSource,
    TimedScoreResult,
} from './timedPaperAttemptService';

export { validateTimedAttemptInput } from './timedPaperValidation';
export type {
    NormalizedTimedAnswer,
    TimedAttemptInput,
    TimedAttemptValidation,
    ValidatedTimedAttempt,
} from './timedPaperValidation';
