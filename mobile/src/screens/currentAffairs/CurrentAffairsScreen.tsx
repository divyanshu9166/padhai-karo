import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { cacheJson, readCachedJson } from '@/offline/cache';
import { bookmarkCurrentAffairs, getCurrentAffairs, refreshCurrentAffairs, type CurrentAffairsItem } from '@/api/upscProduct';
import { useTranslation } from '@/localization';

export function CurrentAffairsScreen(): React.JSX.Element {
    const t = useTranslation();
    const [items, setItems] = useState<CurrentAffairsItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const load = useCallback(async (): Promise<void> => { setError(null); try { const result = await getCurrentAffairs(); setItems(result.items); await cacheJson('current-affairs', result.items); } catch (err) { const cached = await readCachedJson<CurrentAffairsItem[]>('current-affairs'); if (cached) setItems(cached.value); setError(err instanceof ApiError ? err.message + ' ' + t('currentAffairs.cached') : t('currentAffairs.cached')); } }, [t]);
    useEffect(() => { void (async () => { await load(); setLoading(false); })(); }, [load]);
    const onRefresh = async (): Promise<void> => { setRefreshing(true); await load(); setRefreshing(false); };
    const markRead = async (item: CurrentAffairsItem): Promise<void> => { try { await bookmarkCurrentAffairs(item.id); setItems((list) => list.map((entry) => entry.id === item.id ? { ...entry, bookmark: { id: entry.bookmark?.id ?? item.id, read: true, notes: entry.bookmark?.notes ?? null } } : entry)); } catch { /* keep the feed usable if a bookmark fails */ } };
    return <Screen title={t('currentAffairs.title')}><ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>{loading ? <ActivityIndicator color="#2563eb" /> : <><Pressable style={styles.refreshButton} onPress={() => void refreshCurrentAffairs().then(() => load()).catch(() => setError(t('currentAffairs.refreshError')))}><Text style={styles.refreshText}>{t('currentAffairs.refresh')}</Text></Pressable>{error ? <Text style={styles.error}>{error}</Text> : null}{items.length === 0 ? <Text style={styles.muted}>{t('currentAffairs.noUpdates')}</Text> : items.map((item) => <View key={item.id} style={styles.card}><View style={styles.header}><Text style={styles.category}>{item.category}</Text><Text style={styles.date}>{item.publishedAt.slice(0, 10)}</Text></View><Text style={styles.title}>{item.title}</Text><Text style={styles.summary}>{item.summary}</Text><Text style={styles.source}>{item.sourceName}</Text><Pressable style={styles.readButton} onPress={() => void markRead(item)}><Text style={styles.readText}>{item.bookmark?.read ? t('currentAffairs.savedRead') : t('currentAffairs.markRead')}</Text></Pressable></View>)}</>}</ScrollView></Screen>;
}

const styles = StyleSheet.create({ scroll: { paddingBottom: 32 }, error: { color: '#b91c1c', marginBottom: 12 }, muted: { color: '#6b7280', textAlign: 'center', marginTop: 20 }, refreshButton: { backgroundColor: '#eff6ff', padding: 10, borderRadius: 8, alignItems: 'center', marginBottom: 12 }, refreshText: { color: '#1d4ed8', fontWeight: '700' }, card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 12 }, header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }, category: { fontSize: 12, color: '#2563eb', fontWeight: '800', textTransform: 'uppercase' }, date: { fontSize: 12, color: '#6b7280' }, title: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 6 }, summary: { color: '#374151', lineHeight: 20 }, source: { marginTop: 8, color: '#6b7280', fontSize: 12 }, readButton: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: '#eff6ff', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 7 }, readText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' } });
