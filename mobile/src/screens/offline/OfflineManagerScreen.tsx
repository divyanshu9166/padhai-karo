import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useOffline } from '@/offline';
import { Action, Body, Card, Eyebrow, FeatureScreen, Heading, Muted, Progress, featureStyles, palette } from '@/screens/design/FeatureUi';

export function OfflineManagerScreen(): React.JSX.Element {
    const { status, busy, downloads, outbox, conflicts, workspace, downloadProgress, downloadWorkspace, cancelDownload, syncNow, resolveConflict, refreshConnectivity } = useOffline();
    const percent = downloadProgress?.total ? downloadProgress.current / downloadProgress.total * 100 : 0;
    return <FeatureScreen title="Offline workspace" subtitle="Downloads, queues and conflicts in one place.">
        <Card tone={status === 'offline' ? 'warning' : 'success'}><View style={featureStyles.between}><View><Eyebrow>CONNECTION</Eyebrow><Heading>{status === 'offline' ? 'Offline' : status === 'online' ? 'Connected' : 'Checking…'}</Heading></View><Action label="Check" secondary onPress={() => void refreshConnectivity()} /></View></Card>
        <Card><Heading>Saved on this device</Heading><Body>{downloads.length} papers • {workspace?.pdfs.length ?? 0} PDFs • {workspace?.voiceNotes?.length ?? 0} voice notes</Body><Muted>{workspace ? `Last prepared ${new Date(workspace.generatedAt).toLocaleString()}` : 'Download your workspace before travelling or losing connectivity.'}</Muted><Action label={busy ? 'Preparing workspace…' : 'Download selected media'} disabled={busy || status === 'offline'} onPress={() => void downloadWorkspace()} /></Card>
        {downloadProgress && downloadProgress.phase !== 'complete' ? <Card tone="brand"><Heading>{downloadProgress.phase === 'metadata' ? 'Preparing metadata' : 'Downloading media'}</Heading><Body>{downloadProgress.current} of {downloadProgress.total || '…'} items</Body><Progress value={percent} />{downloadProgress.errors ? <Text style={styles.warning}>{downloadProgress.errors} items need retry.</Text> : null}<Action label="Cancel" secondary onPress={cancelDownload} /></Card> : null}
        <Card><Heading>{outbox.length} offline changes queued</Heading><Muted>Timetable, resources, annotations and study activity sync idempotently.</Muted><Action label={busy ? 'Syncing…' : 'Sync now'} disabled={busy || status === 'offline'} onPress={() => void syncNow()} /></Card>
        {conflicts.length ? <><Heading>{conflicts.length} conflict{conflicts.length === 1 ? '' : 's'} need your choice</Heading>{conflicts.map((conflict) => <Card key={conflict.clientId} tone="warning"><Eyebrow>{conflict.type}</Eyebrow><Body>This item changed on this phone and another device.</Body><View style={featureStyles.row}><Action label="Keep mine" onPress={() => void resolveConflict(conflict.clientId, 'LOCAL')} /><Action label="Use latest" secondary onPress={() => void resolveConflict(conflict.clientId, 'SERVER')} /></View></Card>)}</> : <Card tone="success"><Heading>No unresolved conflicts</Heading><Muted>Your cached workspace has a consistent version.</Muted></Card>}
    </FeatureScreen>;
}

const styles = StyleSheet.create({ warning: { color: '#b45309', marginTop: 8 }, status: { color: palette.ink } });
