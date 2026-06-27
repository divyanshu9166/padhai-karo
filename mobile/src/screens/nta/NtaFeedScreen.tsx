/**
 * NTA update feed screen (task 21.8; Req 20.5, 10.2).
 *
 * Renders the track-filtered, chronological announcements feed from `GET /nta/feed` (the server
 * filters to the user's exam track and orders them most-recent-first). Read-only; the feed is
 * populated by the backend NTA ingestion worker. An empty feed shows an empty state, and a load
 * failure shows a retry affordance.
 *
 * All visible text resolves through `t()` against the stored Language_Preference (Req 10.2). A
 * {@link LanguageToggle} is surfaced here so the language can be switched live and persisted.
 *
 * The feed shape mirrors the backend `ClientNTAAnnouncement` projection
 * (`{ id, examScope, title, body, publishedAt, affectsExamDate, newExamDate }`). The endpoint
 * wrapper is kept local to this screen (no surviving shared module); it uses the generic
 * `request` client so the session token is attached automatically.
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

import { ApiError, request } from '@/api';
import { Screen } from '@/components';
import { LanguageToggle, useTranslation } from '@/localization';

/**
 * A single NTA announcement as returned by `GET /nta/feed`. Mirrors the backend
 * `ClientNTAAnnouncement` projection; `publishedAt` / `newExamDate` arrive as serialized ISO
 * date strings.
 */
interface NtaAnnouncement {
    id: string;
    examScope: string;
    title: string;
    body: string;
    publishedAt: string;
    affectsExamDate: boolean;
    newExamDate: string | null;
}

interface NtaFeedResponse {
    announcements: NtaAnnouncement[];
}

/** `GET /nta/feed` — track-filtered, chronological announcements (Req 20.5). */
function fetchNtaFeed(): Promise<NtaFeedResponse> {
    return request<NtaFeedResponse>('/nta/feed');
}

/** Render a serialized ISO timestamp as its calendar date (YYYY-MM-DD). */
function toDateLabel(iso: string): string {
    return iso.slice(0, 10);
}

export function NtaFeedScreen(): React.JSX.Element {
    const t = useTranslation();

    const [announcements, setAnnouncements] = useState<NtaAnnouncement[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(
        async (): Promise<void> => {
            setError(null);
            try {
                const { announcements: list } = await fetchNtaFeed();
                setAnnouncements(list);
            } catch (err) {
                setError(err instanceof ApiError ? err.message : t('nta.loadError'));
            }
        },
        [t],
    );

    useEffect(() => {
        void (async () => {
            setLoading(true);
            await load();
            setLoading(false);
        })();
    }, [load]);

    const onRefresh = useCallback(async (): Promise<void> => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
    }, [load]);

    let content: React.JSX.Element;
    if (loading) {
        content = (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color="#2563eb" />
            </View>
        );
    } else if (error !== null) {
        content = (
            <View style={styles.centered}>
                <Text style={styles.error}>{error}</Text>
                <Pressable style={styles.retry} onPress={() => void load()}>
                    <Text style={styles.retryText}>{t('common.retry')}</Text>
                </Pressable>
            </View>
        );
    } else {
        content = (
            <ScrollView
                contentContainerStyle={styles.scroll}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
                }
            >
                {announcements.length === 0 ? (
                    <Text style={styles.empty}>{t('nta.empty')}</Text>
                ) : (
                    announcements.map((item) => (
                        <View key={item.id} style={styles.card}>
                            <View style={styles.cardHeader}>
                                <Text style={styles.examScope}>{item.examScope}</Text>
                                <Text style={styles.date}>{toDateLabel(item.publishedAt)}</Text>
                            </View>
                            <Text style={styles.title}>{item.title}</Text>
                            <Text style={styles.body}>{item.body}</Text>
                            {item.affectsExamDate ? (
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>
                                        {t('nta.examDateChanged')}
                                        {item.newExamDate
                                            ? `: ${toDateLabel(item.newExamDate)}`
                                            : ''}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    ))
                )}
            </ScrollView>
        );
    }

    return (
        <Screen title={t('nta.title')}>
            <LanguageToggle />
            {content}
        </Screen>
    );
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    empty: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginTop: 24 },
    error: { color: '#dc2626', fontSize: 14, marginBottom: 12, textAlign: 'center' },
    retry: { paddingVertical: 10, paddingHorizontal: 20 },
    retryText: { color: '#2563eb', fontSize: 15, fontWeight: '600' },
    card: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        backgroundColor: '#ffffff',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    examScope: { fontSize: 12, fontWeight: '700', color: '#2563eb' },
    date: { fontSize: 12, color: '#6b7280' },
    title: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
    body: { fontSize: 14, color: '#374151', lineHeight: 20 },
    badge: {
        marginTop: 8,
        alignSelf: 'flex-start',
        backgroundColor: '#fef3c7',
        borderRadius: 6,
        paddingVertical: 4,
        paddingHorizontal: 8,
    },
    badgeText: { fontSize: 12, fontWeight: '600', color: '#92400e' },
});
