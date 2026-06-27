/**
 * Public surface of the Calendar-Event service (task 6.7; Req 16.1, 16.2, 16.6).
 *
 * Kept as a self-contained service folder (separate from `@/services/timetable`) so it can
 * evolve independently of the timetable generation orchestration.
 */
export {
    createCalendarEventHandler,
    deleteCalendarEventHandler,
    holidaySprintHandler,
    listCalendarEventsHandler,
} from './calendarEventService';
export type { CalendarEventRouteContext } from './calendarEventService';

export {
    CALENDAR_EVENT_TYPES,
    isKnownCalendarEventType,
    validateCalendarEventInput,
} from './calendarEventValidation';
export type {
    CalendarEventInput,
    CalendarEventValidation,
    ValidatedCalendarEvent,
} from './calendarEventValidation';

export { NO_SPRINT_OFFER, buildHolidaySprintOffer } from './holidaySprint';
export type {
    HolidaySprintOffer,
    HolidaySprintOptions,
    HolidaySprintPlan,
    SprintCandidateEvent,
} from './holidaySprint';
