/**
 * Holiday-sprint offer banner (task 21.3; Req 16.6).
 *
 * When the Backend_API reports an upcoming HOLIDAY Calendar_Event, it offers an intensified
 * study sprint plan (`GET /calendar-events/holiday-sprint`). This banner surfaces that offer
 * with the holiday date range and the suggested intensified daily study load. It renders
 * nothing when no holiday is upcoming.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { HolidaySprintPlan } from '@/api';
import { summarizeSprint } from './sprintSummary';

interface HolidaySprintBannerProps {
    plan: HolidaySprintPlan | null;
    labels: {
        title: string;
        summary: string;
        suggestedDaily: string;
        hours: string;
    };
}

export function HolidaySprintBanner({
    plan,
    labels,
}: HolidaySprintBannerProps): React.JSX.Element | null {
    if (!plan) {
        return null;
    }
    const summary = summarizeSprint(plan);

    return (
        <View style={styles.banner}>
            <Text style={styles.title}>{labels.title}</Text>
            <Text style={styles.range}>
                {summary.range} · {summary.days}d
            </Text>
            <Text style={styles.summary}>{labels.summary}</Text>
            <Text style={styles.suggested}>
                {labels.suggestedDaily}: {summary.dailyHours} {labels.hours}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        backgroundColor: '#fef3c7',
        borderColor: '#f59e0b',
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
    },
    title: { fontSize: 14, fontWeight: '700', color: '#92400e' },
    range: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#b45309' },
    summary: { marginTop: 4, fontSize: 13, color: '#78350f' },
    suggested: { marginTop: 6, fontSize: 13, fontWeight: '600', color: '#92400e' },
});
