export { getDashboardHandler } from './dashboardService';
export {
    aggregateFocusBySubject,
    computeStreak,
    computeSyllabusCompletionPercent,
    currentDayWindow,
    currentWeekWindow,
    filterSessionsInWindow,
    startOfUtcDay,
    utcDayKey,
} from './dashboardAggregation';
export type {
    FocusSessionRow,
    PerSubjectStudyTime,
    TimeWindow,
} from './dashboardAggregation';
