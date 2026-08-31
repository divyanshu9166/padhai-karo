import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { getAnalyticsDashboard } from '@/api/upscProduct';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';

type Row = Record<string, unknown>;
type RangeDays = 7 | 30 | 90 | 0;
type Section = 'overview' | 'weak' | 'scores' | 'topics' | 'sessions' | 'benchmark';
type Selection = { kind: 'weak' | 'score' | 'topic' | 'session'; value: unknown } | null;

function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function row(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function text(value: unknown, fallback = '—'): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback; }
function name(value: unknown): string { const item = row(value); return text(item.topicName ?? item.subjectName ?? item.name ?? item.label ?? item.title ?? item.category, 'Insight'); }
function dateLabel(value: unknown): string { if (typeof value !== 'string') return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(); }
function metric(value: unknown): number {
    const item = row(value);
    const normalized = number(item.normalizedPercent ?? item.normalizedScore);
    if (normalized !== null) return Math.max(0, Math.min(100, normalized));
    const weakScore = number(item.weakAreaScore);
    if (weakScore !== null) return Math.max(0, Math.min(100, weakScore * 100));
    const candidate = item.accuracyPercent ?? item.scorePercent ?? item.score ?? item.value ?? item.percent ?? item.averageScore;
    const parsed = number(candidate);
    return parsed === null ? 0 : Math.max(0, Math.min(100, parsed));
}
function distribution(value: unknown): Array<{ label: string; value: number }> {
    if (Array.isArray(value)) return value.map((item) => { const itemRow = row(item); return { label: name(item), value: number(itemRow.totalMinutes ?? itemRow.focusedMinutes ?? itemRow.minutes ?? itemRow.count ?? itemRow.value ?? itemRow.percent) ?? 0 }; });
    return Object.entries(row(value)).map(([label, raw]) => ({ label, value: number(raw) ?? 0 }));
}
function rankEstimate(value: unknown): { low: string; high: string; unit: string; insufficient: string | null } {
    const prediction = row(value);
    const estimate = row(prediction.estimate);
    if (prediction.kind === 'INSUFFICIENT_DATA') return { low: '—', high: '—', unit: '', insufficient: text(prediction.minimumRequired, '—') };
    return { low: text(estimate.low ?? prediction.estimatedRankLow ?? prediction.rankLow), high: text(estimate.high ?? prediction.estimatedRankHigh ?? prediction.rankHigh), unit: text(estimate.unit ?? prediction.unit, ''), insufficient: null };
}

function Bar({ label, value, caption, selected, color = '#2563eb', onPress }: { label: string; value: number; caption?: string; selected?: boolean; color?: string; onPress?: () => void }): React.JSX.Element {
    const content = <><View style={styles.barTop}><Text style={styles.rowLabel} numberOfLines={2}>{label}</Text><Text style={styles.rowValue}>{caption ?? `${Math.round(value)}%`}</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${Math.max(value > 0 ? 4 : 0, Math.min(100, value))}%`, backgroundColor: color }]} /></View></>;
    return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} style={[styles.barRow, selected && styles.barSelected]} onPress={onPress}>{content}</Pressable> : <View style={styles.barRow}>{content}</View>;
}

function DetailCard({ selection, t }: { selection: Selection; t: (key: string) => string }): React.JSX.Element | null {
    if (!selection) return null;
    const item = row(selection.value);
    if (selection.kind === 'score') return <View style={styles.detailCard}><Text style={styles.heading}>{t('analytics.detail')}: {dateLabel(item.date ?? item.createdAt) || t('analytics.scoreTrajectory')}</Text><Text style={styles.detailText}>{t('analytics.score')}: {metric(item) ? `${Math.round(metric(item))}%` : t('analytics.review')}</Text><Text style={styles.detailText}>{t('analytics.source')}: {text(item.source ?? item.type, t('analytics.review'))}</Text><Text style={styles.detailText}>{t('analytics.obtained')}: {text(item.obtained ?? item.score, '—')} / {text(item.max ?? item.maximum, '—')}</Text></View>;
    if (selection.kind === 'topic') return <View style={styles.detailCard}><Text style={styles.heading}>{t('analytics.detail')}: {name(item)}</Text><Text style={styles.detailText}>{t('analytics.subject')}: {text(item.subjectName, t('analytics.review'))}</Text><Text style={styles.detailText}>{t('analytics.appearances')}: {text(item.appearanceCount, '0')}</Text><Text style={styles.detailText}>{t('analytics.averagePerYear')}: {text(item.avgQuestionsPerYear, '0')}</Text><Text style={styles.detailText}>{t('analytics.coverage')}: {item.hasFrequencyData === false ? t('analytics.noFrequency') : text(item.yearSpan ? `${row(item.yearSpan).start}–${row(item.yearSpan).end}` : '', t('analytics.review'))}</Text></View>;
    if (selection.kind === 'session') return <View style={styles.detailCard}><Text style={styles.heading}>{t('analytics.detail')}: {name(item)}</Text><Text style={styles.detailText}>{t('analytics.minutes')}: {text(item.totalMinutes ?? item.minutes ?? item.value, '0')}</Text><Text style={styles.detailText}>{t('analytics.share')}: {text(item.percent, t('analytics.review'))}</Text></View>;
    return <View style={styles.detailCard}><Text style={styles.heading}>{t('analytics.detail')}: {name(item)}</Text><Text style={styles.detailText}>{t('analytics.attempts')}: {text(item.attempts ?? item.attemptCount ?? item.attemptedCount, '0')}</Text><Text style={styles.detailText}>{t('analytics.incorrect')}: {text(item.incorrectCount, '0')}</Text><Text style={styles.detailText}>{t('analytics.scoreTrajectory')}: {metric(item) ? `${Math.round(metric(item))}%` : t('analytics.review')}</Text><Text style={styles.detailText}>{t('common.trend')}: {text(item.trend ?? item.direction, 'steady')}</Text></View>;
}

export function AnalyticsScreen(): React.JSX.Element {
    const t = useTranslation();
    const [data, setData] = useState<Awaited<ReturnType<typeof getAnalyticsDashboard>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [rangeDays, setRangeDays] = useState<RangeDays>(30);
    const [section, setSection] = useState<Section>('overview');
    const [selection, setSelection] = useState<Selection>(null);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true); setError(null); setSelection(null);
        try { setData(await getAnalyticsDashboard(rangeDays || undefined)); }
        catch (err) { setError(err instanceof ApiError ? err.message : t('common.couldNotLoadAnalytics')); }
        finally { setLoading(false); }
    }, [rangeDays, t]);
    useEffect(() => { void load(); }, [load]);

    const weakAreas = useMemo(() => list(data?.weakAreas), [data?.weakAreas]);
    const points = useMemo(() => list(data?.points), [data?.points]);
    const topics = useMemo(() => list(data?.topics), [data?.topics]);
    const sessions = useMemo(() => distribution(data?.sessionTypeDistribution), [data?.sessionTypeDistribution]);
    const scoreValues = useMemo(() => points.map(metric).filter((value) => value > 0), [points]);
    const scoreSummary = useMemo(() => ({ latest: scoreValues[scoreValues.length - 1] ?? 0, best: scoreValues.length ? Math.max(...scoreValues) : 0, average: scoreValues.length ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length : 0 }), [scoreValues]);
    const sessionTotal = sessions.reduce((sum, item) => sum + item.value, 0);
    const rank = rankEstimate(data?.rankPrediction);

    const renderSummary = (): React.JSX.Element => <><View style={styles.summaryRow}><View style={styles.summaryCard}><Text style={styles.summaryLabel}>{t('analytics.latestScore')}</Text><Text style={styles.summaryValue}>{scoreSummary.latest ? `${Math.round(scoreSummary.latest)}%` : '—'}</Text></View><View style={styles.summaryCard}><Text style={styles.summaryLabel}>{t('analytics.averageScore')}</Text><Text style={styles.summaryValue}>{scoreSummary.average ? `${Math.round(scoreSummary.average)}%` : '—'}</Text></View><View style={styles.summaryCard}><Text style={styles.summaryLabel}>{t('analytics.bestScore')}</Text><Text style={styles.summaryValue}>{scoreSummary.best ? `${Math.round(scoreSummary.best)}%` : '—'}</Text></View></View><View style={styles.card}><Text style={styles.heading}>{t('analytics.scoreTrajectory')}</Text>{points.length ? points.slice(-5).map((item, index) => <Bar key={index} label={dateLabel(row(item).date ?? row(item).createdAt) || name(item)} value={metric(item)} caption={`${Math.round(metric(item))}%`} selected={selection?.kind === 'score' && selection.value === item} color="#16a34a" onPress={() => setSelection({ kind: 'score', value: item })} />) : <Text style={styles.muted}>{t('analytics.emptyScores')}</Text>}</View><View style={styles.card}><Text style={styles.heading}>{t('analytics.weakAreas')}</Text>{weakAreas.slice(0, 5).map((item, index) => <Bar key={index} label={name(item)} value={metric(item)} selected={selection?.kind === 'weak' && selection.value === item} onPress={() => setSelection({ kind: 'weak', value: item })} />)}{weakAreas.length === 0 ? <Text style={styles.muted}>{t('analytics.emptyWeak')}</Text> : null}</View></>;
    const renderWeakAreas = (): React.JSX.Element => <View style={styles.card}><Text style={styles.heading}>{t('analytics.weakAreas')}</Text><Text style={styles.muted}>{t('analytics.tapToDrillDown')}</Text>{weakAreas.map((item, index) => <Bar key={index} label={name(item)} value={metric(item)} selected={selection?.kind === 'weak' && selection.value === item} onPress={() => setSelection({ kind: 'weak', value: item })} />)}{weakAreas.length === 0 ? <Text style={styles.muted}>{t('analytics.emptyWeak')}</Text> : null}</View>;
    const renderScores = (): React.JSX.Element => <View style={styles.card}><Text style={styles.heading}>{t('analytics.scoreTrajectory')}</Text><Text style={styles.muted}>{t('analytics.tapToDrillDown')}</Text>{points.length ? points.map((item, index) => <Bar key={index} label={`${dateLabel(row(item).date ?? row(item).createdAt) || name(item)}${row(item).source ? ` · ${text(row(item).source, '')}` : ''}`} value={metric(item)} caption={`${Math.round(metric(item))}%`} selected={selection?.kind === 'score' && selection.value === item} color="#16a34a" onPress={() => setSelection({ kind: 'score', value: item })} />) : <Text style={styles.muted}>{t('analytics.emptyScores')}</Text>}</View>;
    const renderTopics = (): React.JSX.Element => <View style={styles.card}><Text style={styles.heading}>{t('analytics.topicTrends')}</Text><Text style={styles.muted}>{t('analytics.tapToDrillDown')}</Text>{topics.map((item, index) => { const itemRow = row(item); const value = number(itemRow.avgQuestionsPerYear ?? itemRow.appearanceCount ?? itemRow.frequency) ?? 0; const max = Math.max(1, ...topics.map((topic) => number(row(topic).avgQuestionsPerYear ?? row(topic).appearanceCount ?? row(topic).frequency) ?? 0)); return <Bar key={index} label={name(item)} value={value / max * 100} caption={text(itemRow.appearanceCount ?? itemRow.avgQuestionsPerYear, t('analytics.review'))} selected={selection?.kind === 'topic' && selection.value === item} onPress={() => setSelection({ kind: 'topic', value: item })} color="#7c3aed" />; })}{topics.length === 0 ? <Text style={styles.muted}>{t('analytics.emptyTopics')}</Text> : null}</View>;
    const renderSessions = (): React.JSX.Element => <View style={styles.card}><Text style={styles.heading}>{t('analytics.sessionMix')}</Text>{sessions.map((item) => { const share = sessionTotal > 0 ? item.value / sessionTotal * 100 : 0; return <Bar key={item.label} label={item.label} value={share} caption={`${Math.round(item.value)} ${t('analytics.minutes')}`} selected={selection?.kind === 'session' && selection.value === item} onPress={() => setSelection({ kind: 'session', value: item })} color="#ea580c" />; })}{sessions.length === 0 ? <Text style={styles.muted}>{t('analytics.emptyScores')}</Text> : null}</View>;
    const renderBenchmark = (): React.JSX.Element => <><View style={styles.card}><Text style={styles.heading}>{t('analytics.benchmark')}</Text>{data?.benchmark ? <><Text style={styles.bigMetric}>{text(row(data.benchmark).percentile ?? row(data.benchmark).estimatedPercentile)}%</Text><Text style={styles.detailText}>{t('analytics.percentile')} · {t('analytics.cohort')}: {text(row(data.benchmark).cohortSize ?? row(data.benchmark).sampleSize)}</Text><Text style={styles.detailText}>{t('analytics.minutes')}: {text(row(data.benchmark).userMinutes, '0')} · {t('analytics.median')}: {text(row(data.benchmark).cohortMedianMinutes, '0')}</Text></> : <Text style={styles.muted}>{t('analytics.noBenchmark')}</Text>}</View><View style={styles.card}><Text style={styles.heading}>{t('analytics.rankPrediction')}</Text>{data?.rankPrediction && !rank.insufficient ? <><Text style={styles.bigMetric}>{rank.low}–{rank.high}</Text><Text style={styles.detailText}>{rank.unit}</Text><Text style={styles.detailText}>{text(row(data.rankPrediction).kind, '')}</Text></> : <Text style={styles.muted}>{rank.insufficient ? `${t('analytics.needMoreScores')}: ${rank.insufficient}` : t('analytics.noRank')}</Text>}</View></>;

    return <Screen title={t('analytics.title')}>
        {loading ? <ActivityIndicator color="#2563eb" /> : <ScrollView contentContainerStyle={styles.scroll}>
            {error ? <View style={styles.errorBox}><Text style={styles.error}>{error}</Text><Pressable style={styles.secondary} onPress={() => void load()}><Text style={styles.secondaryText}>{t('analytics.retry')}</Text></Pressable></View> : null}
            {(data?.errors ?? []).length > 0 ? <View style={styles.warningBox}><Text style={styles.warning}>{t('analytics.partialError')}</Text><Pressable style={styles.secondary} onPress={() => void load()}><Text style={styles.secondaryText}>{t('analytics.refreshAll')}</Text></Pressable></View> : null}
            <Text style={styles.intro}>{t('analytics.intro')}</Text>
            <Text style={styles.controlLabel}>{t('analytics.scoreRange')}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controlRow}>{([7, 30, 90, 0] as const).map((value) => <Pressable key={value} accessibilityRole="button" style={[styles.controlChip, rangeDays === value && styles.controlChipActive]} onPress={() => setRangeDays(value)}><Text style={[styles.controlText, rangeDays === value && styles.controlTextActive]}>{value === 0 ? t('analytics.allTime') : `${t('analytics.last')} ${value}d`}</Text></Pressable>)}</ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controlRow}>{([['overview', 'analytics.overview'], ['weak', 'analytics.weakAreas'], ['scores', 'analytics.scoreTrajectory'], ['topics', 'analytics.topicTrends'], ['sessions', 'analytics.sessionMix'], ['benchmark', 'analytics.benchmark']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: section === value }} style={[styles.controlChip, section === value && styles.controlChipActive]} onPress={() => { setSection(value); setSelection(null); }}><Text style={[styles.controlText, section === value && styles.controlTextActive]}>{t(label)}</Text></Pressable>)}</ScrollView>
            {section === 'overview' ? renderSummary() : null}
            {section === 'weak' ? renderWeakAreas() : null}
            {section === 'scores' ? renderScores() : null}
            {section === 'topics' ? renderTopics() : null}
            {section === 'sessions' ? renderSessions() : null}
            {section === 'benchmark' ? renderBenchmark() : null}
            <DetailCard selection={selection} t={t} />
        </ScrollView>}
    </Screen>;
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 }, intro: { color: '#6b7280', lineHeight: 20, marginBottom: 8 }, controlLabel: { color: '#475569', fontSize: 12, fontWeight: '800', marginTop: 4, marginBottom: 4 }, controlRow: { paddingBottom: 8 }, controlChip: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, marginRight: 7, backgroundColor: '#fff' }, controlChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' }, controlText: { color: '#334155', fontWeight: '700', fontSize: 12 }, controlTextActive: { color: '#fff' }, summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 10 }, summaryCard: { flex: 1, borderWidth: 1, borderColor: '#dbeafe', borderRadius: 10, padding: 10, backgroundColor: '#eff6ff' }, summaryLabel: { color: '#475569', fontSize: 11, lineHeight: 15 }, summaryValue: { color: '#1d4ed8', fontSize: 20, fontWeight: '800', marginTop: 4 }, card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, backgroundColor: '#fff', marginBottom: 10 }, detailCard: { borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 12, padding: 14, backgroundColor: '#eff6ff', marginBottom: 10 }, heading: { color: '#111827', fontWeight: '800', fontSize: 16, marginBottom: 8 }, rowLabel: { color: '#374151', flex: 1, marginRight: 8 }, rowValue: { color: '#1d4ed8', fontWeight: '700', minWidth: 55, textAlign: 'right' }, barRow: { paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#f3f4f6' }, barSelected: { backgroundColor: '#f8fafc', borderRadius: 8, paddingHorizontal: 8 }, barTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 }, track: { height: 8, backgroundColor: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }, fill: { height: 8, borderRadius: 999 }, detailText: { color: '#374151', lineHeight: 20 }, bigMetric: { color: '#1d4ed8', fontSize: 28, fontWeight: '800', marginBottom: 4 }, muted: { color: '#6b7280', lineHeight: 19, marginBottom: 8 }, errorBox: { borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 10 }, warningBox: { borderWidth: 1, borderColor: '#fde68a', backgroundColor: '#fffbeb', borderRadius: 10, padding: 12, marginBottom: 10 }, error: { color: '#b91c1c' }, warning: { color: '#92400e' }, secondary: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, padding: 9, marginTop: 8 }, secondaryText: { color: '#2563eb', fontWeight: '700' },
});
