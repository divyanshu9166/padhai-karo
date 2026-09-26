import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { getDailyBriefing, refreshDailyBriefing, type DailyBriefing } from '@/api/upscProduct';
import { interpolate, useTranslation } from '@/localization';
import { Action, Body, Card, Eyebrow, FeatureScreen, Heading, Muted, palette } from '@/screens/design/FeatureUi';

function values(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, unknown>).title ?? (item as Record<string, unknown>).name ?? (item as Record<string, unknown>).label ?? '') : '').filter(Boolean);
}

export function DailyBriefingScreen(): React.JSX.Element {
    const t = useTranslation();
    const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const load = useCallback(async (refresh = false) => { setLoading(true); setError(null); try { setBriefing((await (refresh ? refreshDailyBriefing() : getDailyBriefing())).briefing); } catch (reason) { setError(reason instanceof Error ? reason.message : t('briefing.loadError')); } finally { setLoading(false); } }, []);
    useEffect(() => { void load(); }, [load]);
    const actions = briefing?.insights.source === 'AI' && briefing.insights.ai?.keyPoints?.length
        ? briefing.insights.ai.keyPoints
        : briefing?.insights.actions ?? [];
    const updates = values(briefing?.insights.updates);
    return <FeatureScreen title={t('more.dailyBriefingTitle')} subtitle={t('briefing.subtitle')}>
        {loading ? <ActivityIndicator color={palette.brand} /> : null}
        {error ? <Card tone="warning"><Heading>{t('briefing.unavailable')}</Heading><Body>{error}</Body><Action label={t('common.retry')} onPress={() => void load()} secondary /></Card> : null}
        {briefing ? <>
            <Card tone="brand"><Eyebrow>{briefing.insights.source === 'AI' ? t('briefing.aiPersonalised') : t('briefing.ruleBased')}</Eyebrow><Text style={styles.hero}>{briefing.insights.greeting}</Text><Muted>{briefing.countdownDays === null ? briefing.phase : `${interpolate(t('today.daysRemaining'), { count: briefing.countdownDays })} • ${briefing.phase}`}</Muted></Card>
            {briefing.insights.source === 'AI' && briefing.insights.ai?.title ? <Heading>{briefing.insights.ai.title}</Heading> : <Heading>{t('briefing.attention')}</Heading>}
            {actions.length ? actions.map((action, index) => <Card key={`${index}-${action}`}><Eyebrow>{interpolate(t('today.priority'), { n: index + 1 })}</Eyebrow><Body>{action}</Body></Card>) : <Card><Muted>{t('briefing.noUrgent')}</Muted></Card>}
            {updates.length ? <><Heading>{t('briefing.currentAffairs')}</Heading>{updates.slice(0, 4).map((update) => <Card key={update} tone="success"><Body>{update}</Body></Card>)}</> : null}
            <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.refresh}><Text style={styles.refreshText}>{t('briefing.refresh')}</Text></Pressable>
        </> : null}
    </FeatureScreen>;
}

const styles = StyleSheet.create({ hero: { color: palette.ink, fontSize: 24, lineHeight: 31, fontWeight: '800', marginBottom: 8 }, refresh: { padding: 14, alignItems: 'center' }, refreshText: { color: palette.brandText, fontWeight: '700' } });
