import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useOffline } from '@/offline';
import { interpolate, useTranslation } from '@/localization';
import { Action, Body, Card, Eyebrow, FeatureScreen, Heading, Muted, Progress, featureStyles, palette } from '@/screens/design/FeatureUi';

export function OfflineManagerScreen(): React.JSX.Element {
    const t = useTranslation();
    const { status, busy, downloads, outbox, conflicts, workspace, downloadProgress, downloadWorkspace, cancelDownload, syncNow, resolveConflict, refreshConnectivity } = useOffline();
    const percent = downloadProgress?.total ? downloadProgress.current / downloadProgress.total * 100 : 0;
    return <FeatureScreen title={t('offline.title')} subtitle={t('offline.subtitle')}>
        <Card tone={status === 'offline' ? 'warning' : 'success'}><View style={featureStyles.between}><View><Eyebrow>{t('offline.connection')}</Eyebrow><Heading>{status === 'offline' ? t('offline.offline') : status === 'online' ? t('offline.connected') : t('offline.checking')}</Heading></View><Action label={t('offline.check')} secondary onPress={() => void refreshConnectivity()} /></View></Card>
        <Card><Heading>{t('offline.savedHeading')}</Heading><Body>{interpolate(t('offline.savedSummary'), { papers: downloads.length, pdfs: workspace?.pdfs.length ?? 0, voice: workspace?.voiceNotes?.length ?? 0 })}</Body><Muted>{workspace ? interpolate(t('offline.lastPrepared'), { date: new Date(workspace.generatedAt).toLocaleString() }) : t('offline.downloadHint')}</Muted><Action label={busy ? t('offline.preparing') : t('offline.downloadMedia')} disabled={busy || status === 'offline'} onPress={() => void downloadWorkspace()} /></Card>
        {downloadProgress && downloadProgress.phase !== 'complete' ? <Card tone="brand"><Heading>{downloadProgress.phase === 'metadata' ? t('offline.preparingMetadata') : t('offline.downloadingMedia')}</Heading><Body>{interpolate(t('offline.itemsProgress'), { current: downloadProgress.current, total: downloadProgress.total || '…' })}</Body><Progress value={percent} />{downloadProgress.errors ? <Text style={styles.warning}>{interpolate(t('offline.itemsRetry'), { count: downloadProgress.errors })}</Text> : null}<Action label={t('common.cancel')} secondary onPress={cancelDownload} /></Card> : null}
        <Card><Heading>{interpolate(t('offline.changesQueued'), { count: outbox.length })}</Heading><Muted>{t('offline.syncNote')}</Muted><Action label={busy ? t('offline.syncing') : t('offline.syncNow')} disabled={busy || status === 'offline'} onPress={() => void syncNow()} /></Card>
        {conflicts.length ? <><Heading>{interpolate(t('offline.conflicts'), { count: conflicts.length })}</Heading>{conflicts.map((conflict) => <Card key={conflict.clientId} tone="warning"><Eyebrow>{conflict.type}</Eyebrow><Body>{t('offline.conflictText')}</Body><View style={featureStyles.row}><Action label={t('offline.keepMine')} onPress={() => void resolveConflict(conflict.clientId, 'LOCAL')} /><Action label={t('offline.useLatest')} secondary onPress={() => void resolveConflict(conflict.clientId, 'SERVER')} /></View></Card>)}</> : <Card tone="success"><Heading>{t('offline.noConflicts')}</Heading><Muted>{t('offline.consistent')}</Muted></Card>}
    </FeatureScreen>;
}

const styles = StyleSheet.create({ warning: { color: '#b45309', marginTop: 8 }, status: { color: palette.ink } });
