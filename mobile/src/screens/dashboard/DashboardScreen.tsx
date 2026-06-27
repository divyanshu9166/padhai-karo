/**
 * Progress dashboard screen (task 21.5; Req 5.1, 5.4, 12.1, 12.4, 14.8).
 *
 * Shows per-subject focused time (today/week), the current streak, syllabus completion, the
 * AHEAD/BEHIND velocity projection, the chapter list with a forward-only status advance
 * (Req 12.1), and the daily check-in (Req 14.1). All authoritative values come from the
 * Backend_API; the screen only renders and submits intents.
 *
 * Reconstructed during scaffold recovery; composes the surviving dashboard `api`, `ui`,
 * `helpers`, and `DailyCheckIn` modules.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';

import {
    getChapters,
    getDashboard,
    getVelocity,
    updateChapterStatus,
    type Chapter,
    type DashboardResponse,
    type VelocityResponse,
} from './api';
import { DailyCheckIn } from './DailyCheckIn';
import { chapterStatusKey, formatIsoDate, formatMinutes, nextChapterStatus } from './helpers';
import { Card, SectionHeading, StatRow, StatusBadge } from './ui';

interface Loaded {
    dashboard: DashboardResponse;
    chapters: Chapter[];
    velocity: VelocityResponse | null;
}

export function DashboardScreen(): React.JSX.Element {
    const t = useTranslation();

    const [data, setData] = useState<Loaded | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [advancing, setAdvancing] = useState<string | null>(null);
    const [chapterError, setChapterError] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        setError(null);
        try {
            const [dashboard, chaptersRes] = await Promise.all([getDashboard(), getChapters()]);
            // Velocity is best-effort (it needs a target date); tolerate its absence.
            let velocity: VelocityResponse | null = null;
            try {
                velocity = await getVelocity();
            } catch {
                velocity = null;
            }
            setData({ dashboard, chapters: chaptersRes.chapters, velocity });
        } catch (err) {
            setError(err instanceof ApiError ? err.message : t('dashboard.loadError'));
        }
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);

    const onRefresh = useCallback(async (): Promise<void> => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
    }, [load]);

    const advanceChapter = async (chapter: Chapter): Promise<void> => {
        const next = nextChapterStatus(chapter.status);
        if (!next) {
            return;
        }
        setAdvancing(chapter.id);
        setChapterError(null);
        try {
            const { chapter: updated } = await updateChapterStatus(chapter.id, next);
            setData((prev) =>
                prev
                    ? {
                        ...prev,
                        chapters: prev.chapters.map((c) => (c.id === updated.id ? updated : c)),
                    }
                    : prev,
            );
        } catch (err) {
            // Surface the forward-only transition rule gracefully: the server rejects a
            // backward/illegal move with 422 ILLEGAL_STATUS_TRANSITION (Req 12.1). Show its
            // message when available, otherwise a localized fallback; a reload reconciles state.
            setChapterError(
                err instanceof ApiError ? err.message : t('dashboard.chapterStatusError'),
            );
        } finally {
            setAdvancing(null);
        }
    };

    if (!data && !error) {
        return (
            <Screen title={t('dashboard.title')}>
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#2563eb" />
                </View>
            </Screen>
        );
    }

    if (error && !data) {
        return (
            <Screen title={t('dashboard.title')}>
                <View style={styles.centered}>
                    <Text style={styles.error}>{error}</Text>
                    <Pressable style={styles.retry} onPress={() => void load()}>
                        <Text style={styles.retryText}>{t('common.retry')}</Text>
                    </Pressable>
                </View>
            </Screen>
        );
    }

    const loaded = data as Loaded;

    return (
        <Screen title={t('dashboard.title')}>
            <ScrollView
                contentContainerStyle={styles.scroll}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
                }
            >
                <Card>
                    <SectionHeading
                        title={t('dashboard.streak')}
                        accessory={<Text style={styles.bigValue}>{loaded.dashboard.streak}</Text>}
                    />
                    <StatRow
                        label={t('dashboard.syllabusCompletion')}
                        value={`${Math.round(loaded.dashboard.syllabusCompletionPercent)}%`}
                    />
                </Card>

                <Card>
                    <SectionHeading title={t('dashboard.studyTimeToday')} />
                    {loaded.dashboard.perSubjectToday.length === 0 ? (
                        <Text style={styles.muted}>{t('dashboard.noSessionsToday')}</Text>
                    ) : (
                        loaded.dashboard.perSubjectToday.map((row) => (
                            <StatRow
                                key={row.subjectId}
                                label={row.subjectId}
                                value={formatMinutes(row.focusedDurationMin)}
                            />
                        ))
                    )}
                </Card>

                <Card>
                    <SectionHeading title={t('dashboard.studyTimeWeek')} />
                    {loaded.dashboard.perSubjectWeek.length === 0 ? (
                        <Text style={styles.muted}>{t('dashboard.noSessionsWeek')}</Text>
                    ) : (
                        loaded.dashboard.perSubjectWeek.map((row) => (
                            <StatRow
                                key={row.subjectId}
                                label={row.subjectId}
                                value={formatMinutes(row.focusedDurationMin)}
                            />
                        ))
                    )}
                </Card>

                {loaded.velocity ? (
                    <Card>
                        <SectionHeading title={t('dashboard.velocity')} />
                        <StatRow
                            label={t('dashboard.velocityStatus')}
                            value={
                                loaded.velocity.status === 'AHEAD'
                                    ? t('dashboard.velocityAhead')
                                    : t('dashboard.velocityBehind')
                            }
                        />
                        <StatRow
                            label={t('dashboard.targetCompletion')}
                            value={formatIsoDate(loaded.velocity.targetCompletionDate)}
                        />
                        <StatRow
                            label={t('dashboard.projectedCompletion')}
                            value={formatIsoDate(loaded.velocity.projectedCompletionDate)}
                        />
                        {loaded.velocity.deltaDays !== null ? (
                            <StatRow
                                label={t('dashboard.dayDelta')}
                                value={`${loaded.velocity.deltaDays} ${t('dashboard.daysUnit')}`}
                            />
                        ) : null}
                    </Card>
                ) : null}

                <DailyCheckIn />

                <Card>
                    <SectionHeading title={t('dashboard.chapters')} />
                    {chapterError ? <Text style={styles.error}>{chapterError}</Text> : null}
                    {loaded.chapters.length === 0 ? (
                        <Text style={styles.muted}>{t('dashboard.noChapters')}</Text>
                    ) : (
                        loaded.chapters.map((chapter) => {
                            const next = nextChapterStatus(chapter.status);
                            return (
                                <View key={chapter.id} style={styles.chapterRow}>
                                    <View style={styles.chapterInfo}>
                                        <Text style={styles.chapterName} numberOfLines={1}>
                                            {chapter.name}
                                        </Text>
                                        <StatusBadge status={chapter.status} />
                                    </View>
                                    {next ? (
                                        <Pressable
                                            style={[
                                                styles.advance,
                                                advancing === chapter.id && styles.disabled,
                                            ]}
                                            onPress={() => void advanceChapter(chapter)}
                                            disabled={advancing === chapter.id}
                                        >
                                            <Text style={styles.advanceText}>
                                                → {t(chapterStatusKey(next))}
                                            </Text>
                                        </Pressable>
                                    ) : null}
                                </View>
                            );
                        })
                    )}
                </Card>
            </ScrollView>
        </Screen>
    );
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    error: { color: '#dc2626', fontSize: 14, marginBottom: 12, textAlign: 'center' },
    retry: { paddingVertical: 10, paddingHorizontal: 20 },
    retryText: { color: '#2563eb', fontSize: 15, fontWeight: '600' },
    muted: { fontSize: 14, color: '#6b7280' },
    bigValue: { fontSize: 22, fontWeight: '800', color: '#111827' },
    chapterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
    },
    chapterInfo: { flex: 1, marginRight: 12 },
    chapterName: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 4 },
    advance: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: '#eff6ff',
    },
    advanceText: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
    disabled: { opacity: 0.5 },
});
