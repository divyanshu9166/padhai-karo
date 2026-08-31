export interface BurnoutSignals {
    averageStress: number;
    averageEnergy: number;
    heavyStudyDays: number;
    missedPlanDays: number;
    abandonedSessions?: number;
}

export interface RecoveryPlanDay {
    day: number;
    studyMinutes: number;
    focus: string;
    recovery: string;
}

export function detectBurnoutRisk(signals: BurnoutSignals): 'LOW' | 'WATCH' | 'HIGH' {
    if (signals.averageStress >= 4 && signals.averageEnergy <= 2) return 'HIGH';
    if (signals.heavyStudyDays >= 4 || signals.missedPlanDays >= 3 || (signals.abandonedSessions ?? 0) >= 3 || signals.averageStress >= 3.5) return 'WATCH';
    return 'LOW';
}

export function buildThreeDayRecoveryPlan(start = new Date()): RecoveryPlanDay[] {
    return [
        { day: 1, studyMinutes: 60, focus: 'One high-value revision capsule', recovery: 'Sleep on time, hydrate and take two device-free breaks' },
        { day: 2, studyMinutes: 120, focus: 'One practice set plus mistake review', recovery: 'Walk for 20 minutes and stop before exhaustion' },
        { day: 3, studyMinutes: 180, focus: 'Return to the normal plan at 70% load', recovery: 'Review the week and keep one buffer block' },
    ].map((item) => ({ ...item, date: addDays(start, item.day - 1).toISOString().slice(0, 10) })) as RecoveryPlanDay[];
}

function addDays(date: Date, days: number): Date {
    const value = new Date(date);
    value.setUTCDate(value.getUTCDate() + days);
    return value;
}
