/**
 * Operator PYQ-extraction admin service (task 12.2). Barrel for the job endpoint handlers,
 * their injectable queue seam, and the pure validation/assembly helpers.
 */
export {
    createPyqExtractionJobHandler,
    getPyqExtractionJobHandler,
} from './jobService';
export type {
    AdminQueueJob,
    PyqExtractionJobQueue,
    PyqExtractionJobRouteContext,
    QueueAccessor,
} from './jobService';

export { assembleJobData, validateCreateJobInput } from './validation';
export type { CreateJobInput, CreateJobValidation, ValidatedCreateJob } from './validation';
