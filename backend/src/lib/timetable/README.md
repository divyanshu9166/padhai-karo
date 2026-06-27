# lib/timetable

The deterministic timetable-generation pipeline and its sub-algorithms: free-time grid,
calendar-event budget reshaping, buffer reservation, weightage allocation, energy-based
slotting, subject interleaving, and the adaptive rebalancer. Implemented in task group 6
(Req 3, 11, 12.3, 13, 14.5, 15, 16, 17).

All logic here is **pure** (no database, framework, or clock dependency) so each pipeline
step is independently testable and composable. The generation endpoint (task 6.5) wires the
steps together.

## Implemented so far

### STEP 1 — Free-time grid (`grid.ts`, Req 3.1)

`computeFreeTimeGrid(commitments, wakingWindow?)` subtracts each `FixedCommitment` from the
per-day waking window to produce the free (schedulable) intervals for all seven weekdays.

- Slot granularity is **30 minutes** (`SLOT_MINUTES`); free intervals are snapped INWARD to
  30-min boundaries, which guarantees they are slot-aligned and **never overlap a
  commitment**.
- Default waking window is **06:00–23:00** (`DEFAULT_WAKING_WINDOW`); callers may pass the
  user's own waking hours.
- Helpers: `expandDayToSlotStarts`, `freeMinutesInDay`, `freeMinutesInGrid`.
- Time parsing reuses `parseHHmm` from the onboarding validation module.

### STEP 2 — Weekly study budget reshaped by calendar events (`budget.ts`, Req 16.3–16.5)

`computeWeeklyBudget(weekDates, events?, options?)` starts from a default daily load and
reshapes each date by any covering `CalendarEvent`, then sums the reshaped loads into the
weekly budget `W`.

- `MOCK_TEST` → date excluded entirely, load 0 (Req 16.5).
- `SCHOOL_EXAM` → load × `SCHOOL_EXAM_FACTOR` (**0.5**, < 1) (Req 16.3).
- `HOLIDAY` → load × `HOLIDAY_FACTOR` (**1.5**, > 1) (Req 16.4).
- otherwise → default daily load (`DEFAULT_DAILY_STUDY_HOURS` = **6** hours).
- An event applies to a date when the date is within `[startDate, endDate]` **inclusive**,
  compared at **UTC-day** granularity (consistent with the dashboard and daily audit).
- Overlapping events resolve by precedence **MOCK_TEST > SCHOOL_EXAM > HOLIDAY**.
- `weekDatesFromStart(weekStart)` builds the seven consecutive UTC-midnight dates of a week.

### STEPS 6–7 — Difficulty/energy tagging and energy-based slotting (`energy.ts`, Req 2.9, 13.1–13.4)

STEP 6 tags slots and tasks; STEP 7 matches them.

- `classifySlotEnergy(startMinute, peakWindows)` returns `HIGH` when the slot start falls
  within a marked `Peak_Focus_Window`, else `LOW`. With **no** peak windows set, every slot
  is `LOW` (Req 2.9). `classifySlots(slots, peakWindows)` tags a whole list.
- Each `Peak_Focus_Window` maps to a documented time-of-day band (`PEAK_WINDOW_BANDS`); the
  three bands **tile the full day** with no gaps or overlaps:
  - **MORNING** → 05:00–12:00
  - **AFTERNOON** → 12:00–17:00
  - **NIGHT** → 17:00–24:00 **and** 00:00–05:00 (wraps the small hours)
- `assignTasksToSlots(tasks, energySlots)` greedily places `HARD` tasks into `HIGH`-energy
  slots and `LIGHT` tasks into `LOW`-energy slots (Req 13.2/13.3). When no `HIGH` slot remains
  for a `HARD` task it spills into the next available slot and the placement is flagged
  `scheduledOutsidePeak = true` (Req 13.4). The flag is HARD-only. Matching is deterministic:
  tasks are consumed in input order, slots in ascending `(day, startMinute)` order. Tasks that
  cannot fully fit are returned as `unplacedTasks` without partially consuming slots.

## Defaults & constants

| Constant | Value | Purpose |
| --- | --- | --- |
| `SLOT_MINUTES` | 30 | Scheduling slot granularity |
| `DEFAULT_WAKING_WINDOW` | 06:00–23:00 | Per-day schedulable window |
| `DEFAULT_DAILY_STUDY_HOURS` | 6 | Baseline daily study load |
| `SCHOOL_EXAM_FACTOR` | 0.5 | School-exam day load multiplier (< 1) |
| `HOLIDAY_FACTOR` | 1.5 | Holiday day load multiplier (> 1) |
| `PEAK_WINDOW_BANDS.MORNING` | 05:00–12:00 | High-energy band for MORNING |
| `PEAK_WINDOW_BANDS.AFTERNOON` | 12:00–17:00 | High-energy band for AFTERNOON |
| `PEAK_WINDOW_BANDS.NIGHT` | 17:00–24:00 + 00:00–05:00 | High-energy band for NIGHT |

Property tests for these steps are tasks 6.9 (Property 8), 6.16 (Property 15), and 6.21
(Property 20); only example/unit tests live here for now.
