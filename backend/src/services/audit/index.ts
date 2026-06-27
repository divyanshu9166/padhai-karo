export { recordDailyAuditHandler } from './auditService';
export {
    parseDate,
    validateDailyAuditInput,
} from './auditValidation';
export type {
    DailyAuditInput,
    DailyAuditValidation,
    ValidatedDailyAudit,
} from './auditValidation';
export {
    resolveActualMin,
    sumFocusedMinutes,
} from './resolveActualMin';
export type { AuditFocusSession } from './resolveActualMin';

export {
    computeEfficiencyScore,
    DEFAULT_EFFICIENCY_SCORE,
} from './efficiencyScore';
export type { EfficiencyAuditRow } from './efficiencyScore';
export { getEfficiencyHandler } from './efficiencyService';

export {
    computeRecentRatePerDay,
    computeRemainingHours,
    effectiveEstimatedHours,
    isPendingChapter,
    projectVelocity,
    RECENT_RATE_WINDOW_DAYS,
} from './velocity';
export type {
    ProjectVelocityInput,
    VelocityAuditRow,
    VelocityChapterRow,
    VelocityProjection,
    VelocityStatus,
} from './velocity';
export { getVelocityHandler } from './velocityService';
