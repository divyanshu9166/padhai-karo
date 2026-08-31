import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components';
import { useTranslation, type StringKey } from '@/localization';
import { useOffline } from '@/offline';
import type { MoreStackScreenProps } from './types';

type MoreRoute = Exclude<keyof import('./types').MoreStackParamList, 'More'>;

const MENU: readonly { route: MoreRoute; titleKey: StringKey; descriptionKey: StringKey }[] = [
    { route: 'Notes', titleKey: 'ai.title', descriptionKey: 'more.notesDescription' },
    { route: 'Updates', titleKey: 'currentAffairs.title', descriptionKey: 'more.updatesDescription' },
    { route: 'Tools', titleKey: 'tools.title', descriptionKey: 'more.toolsDescription' },
    { route: 'Library', titleKey: 'library.title', descriptionKey: 'more.libraryDescription' },
    { route: 'Community', titleKey: 'community.title', descriptionKey: 'more.communityDescription' },
    { route: 'Analytics', titleKey: 'analytics.title', descriptionKey: 'more.analyticsDescription' },
];

export function MoreMenuScreen({ navigation }: MoreStackScreenProps<'More'>): React.JSX.Element {
    const t = useTranslation();
    const { isOffline, busy, workspace, downloadWorkspace, downloadProgress, cancelDownload, conflicts, resolveConflict } = useOffline();
    return (
        <Screen title={t('more.title')}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <Text style={styles.intro}>{t('more.intro')}</Text>
                {MENU.map((item) => (
                    <Pressable
                        key={item.route}
                        accessibilityRole="button"
                        style={styles.card}
                        onPress={() => navigation.navigate(item.route)}
                    >
                        <View style={styles.copy}>
                            <Text style={styles.title}>{t(item.titleKey)}</Text>
                            <Text style={styles.description}>{t(item.descriptionKey)}</Text>
                        </View>
                        <Text style={styles.chevron}>›</Text>
                    </Pressable>
                ))}
                <View style={styles.offlineCard}>
                    <Text style={styles.title}>{t('more.offlineTitle')}</Text>
                    <Text style={styles.description}>{t('more.offlineDescription')}</Text>
                    <Pressable style={styles.offlineButton} onPress={() => void downloadWorkspace()} disabled={busy || isOffline}>
                        <Text style={styles.offlineButtonText}>{isOffline ? t('more.reconnect') : busy ? t('more.downloading') : t('more.downloadWorkspace')}</Text>
                    </Pressable>
                    {downloadProgress && busy && downloadProgress.phase !== 'complete' ? <View style={styles.progressBox}>
                        <Text style={styles.progressText}>{downloadProgress.phase === 'metadata' ? t('more.preparingWorkspace') : t('more.downloadingMedia')} · {downloadProgress.total > 0 ? `${downloadProgress.current}/${downloadProgress.total}` : t('common.working')}</Text>
                        {downloadProgress.total > 0 ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, Math.round(downloadProgress.current / downloadProgress.total * 100))}%` }]} /></View> : null}
                        {downloadProgress.errors > 0 ? <Text style={styles.progressError}>{downloadProgress.errors} {t('more.downloadErrors')}</Text> : null}
                        <Pressable style={styles.cancelDownload} onPress={cancelDownload}><Text style={styles.cancelDownloadText}>{t('more.cancelDownload')}</Text></Pressable>
                    </View> : null}
                    {workspace ? <Text style={styles.cached}>{t('more.cached')} {new Date(workspace.generatedAt).toLocaleString()} · {workspace.pdfs.length} PDFs · {workspace.resources.length} resources</Text> : null}
                </View>
                {conflicts.length > 0 ? <View style={styles.conflictCard}>
                    <Text style={styles.title}>{t('more.offlineConflicts')}</Text>
                    <Text style={styles.description}>{t('more.conflictDescription')}</Text>
                    {conflicts.slice(0, 5).map((conflict) => <View key={conflict.clientId} style={styles.conflictRow}><Text style={styles.description}>{conflict.type}</Text><View style={styles.buttonRow}><Pressable style={styles.resolveButton} onPress={() => void resolveConflict(conflict.clientId, 'SERVER')}><Text style={styles.resolveText}>{t('more.keepServer')}</Text></Pressable><Pressable style={styles.resolveButton} onPress={() => void resolveConflict(conflict.clientId, 'LOCAL')}><Text style={styles.resolveText}>{t('more.keepMine')}</Text></Pressable></View></View>)}
                </View> : null}
            </ScrollView>
        </Screen>
    );
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 },
    intro: { color: '#6b7280', lineHeight: 20, marginBottom: 12 },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 12,
        padding: 15,
        marginBottom: 10,
        backgroundColor: '#ffffff',
    },
    copy: { flex: 1, paddingRight: 12 },
    title: { color: '#111827', fontSize: 16, fontWeight: '800', marginBottom: 4 },
    description: { color: '#6b7280', lineHeight: 19 },
    chevron: { color: '#2563eb', fontSize: 28, lineHeight: 28 },
    offlineCard: { borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 12, padding: 15, marginBottom: 10, backgroundColor: '#eff6ff' },
    offlineButton: { backgroundColor: '#2563eb', borderRadius: 8, padding: 11, alignItems: 'center', marginTop: 10 },
    offlineButtonText: { color: '#ffffff', fontWeight: '700' },
    cached: { color: '#1d4ed8', fontSize: 12, marginTop: 9 },
    progressBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#bfdbfe', paddingTop: 10 },
    progressText: { color: '#1e40af', fontSize: 12 },
    progressTrack: { height: 7, backgroundColor: '#dbeafe', borderRadius: 999, overflow: 'hidden', marginTop: 7 },
    progressFill: { height: 7, backgroundColor: '#1d4ed8', borderRadius: 999 },
    progressError: { color: '#b45309', fontSize: 12, marginTop: 5 },
    cancelDownload: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#1d4ed8', borderRadius: 8, padding: 8, marginTop: 8 },
    cancelDownloadText: { color: '#1d4ed8', fontWeight: '700' },
    conflictCard: { borderWidth: 1, borderColor: '#fed7aa', borderRadius: 12, padding: 15, marginBottom: 10, backgroundColor: '#fff7ed' },
    conflictRow: { borderTopWidth: 1, borderTopColor: '#fed7aa', paddingTop: 9, marginTop: 9 },
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap' },
    resolveButton: { borderWidth: 1, borderColor: '#c2410c', borderRadius: 8, padding: 9, marginTop: 8, marginRight: 8 },
    resolveText: { color: '#c2410c', fontWeight: '700' },
});
