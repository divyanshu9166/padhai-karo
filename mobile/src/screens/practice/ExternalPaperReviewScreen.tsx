import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation, type StringKey } from '@/localization';
import {
    createExternalPaperReview,
    deleteExternalPaperReview,
    getExternalPaperReviews,
    uploadPdfDocument,
    type ExternalPaperAnalysis,
    type ExternalPaperBreakdown,
    type ExternalPaperMistakeTag,
    type ExternalPaperReview,
} from '@/api/upscProduct';

type DraftSection = { id: string; label: string; obtainedScore: string; maxScore: string };

const TAGS: Array<{ value: ExternalPaperMistakeTag; label: StringKey }> = [
    { value: 'CONCEPT_GAP', label: 'mistakes.category.conceptGap' },
    { value: 'SILLY_MISTAKE', label: 'mistakes.category.silly' },
    { value: 'TIME_PRESSURE', label: 'mistakes.category.timePressure' },
    { value: 'REVISION_GAP', label: 'paperReview.tagRevisionGap' },
    { value: 'UNATTEMPTED', label: 'paperReview.tagUnattempted' },
];

function today(): string { return new Date().toISOString().slice(0, 10); }
function sectionId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function userMessage(error: unknown, fallback: string): string { return error instanceof ApiError ? error.message : fallback; }

/** A supportive review flow for papers attempted outside the app, without outcome predictions. */
export function ExternalPaperReviewScreen(): React.JSX.Element {
    const t = useTranslation();
    const [title, setTitle] = useState('');
    const [sourceName, setSourceName] = useState('');
    const [testDate, setTestDate] = useState(today());
    const [obtainedScore, setObtainedScore] = useState('');
    const [maxScore, setMaxScore] = useState('');
    const [sections, setSections] = useState<DraftSection[]>([]);
    const [tags, setTags] = useState<ExternalPaperMistakeTag[]>([]);
    const [notes, setNotes] = useState('');
    const [documentId, setDocumentId] = useState<string | null>(null);
    const [documentName, setDocumentName] = useState<string | null>(null);
    const [reviews, setReviews] = useState<ExternalPaperReview[]>([]);
    const [analysis, setAnalysis] = useState<ExternalPaperAnalysis | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        try { setReviews((await getExternalPaperReviews()).reviews); }
        catch (error) { setMessage(userMessage(error, t('paperReview.loadError'))); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const updateSection = (id: string, patch: Partial<DraftSection>): void => {
        setSections((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
    };
    const toggleTag = (tag: ExternalPaperMistakeTag): void => {
        setTags((items) => items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]);
    };
    const attachPdf = async (): Promise<void> => {
        const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
        if (picked.canceled || !picked.assets[0]) return;
        setUploading(true); setMessage(null);
        try {
            const asset = picked.assets[0];
            const uploaded = await uploadPdfDocument(asset.uri, asset.name, ['external-paper-review']);
            setDocumentId(uploaded.document.id); setDocumentName(asset.name);
            setMessage(uploaded.searchable ? t('paperReview.attachedSearchable') : t('paperReview.attachedReference'));
        } catch (error) { setMessage(userMessage(error, t('paperReview.attachError'))); }
        finally { setUploading(false); }
    };
    const save = async (): Promise<void> => {
        const score = Number(obtainedScore); const maximum = Number(maxScore);
        if (!title.trim() || !Number.isFinite(score) || !Number.isFinite(maximum)) {
            setMessage(t('paperReview.needScore')); return;
        }
        const breakdown: ExternalPaperBreakdown[] = [];
        for (const section of sections) {
            const sectionScore = Number(section.obtainedScore); const sectionMaximum = Number(section.maxScore);
            if (!section.label.trim() || !Number.isFinite(sectionScore) || !Number.isFinite(sectionMaximum)) {
                setMessage(t('paperReview.completeSections')); return;
            }
            breakdown.push({ label: section.label.trim(), obtainedScore: sectionScore, maxScore: sectionMaximum });
        }
        setSaving(true); setMessage(null);
        try {
            const created = await createExternalPaperReview({
                title: title.trim(), ...(sourceName.trim() ? { sourceName: sourceName.trim() } : {}), testDate,
                obtainedScore: score, maxScore: maximum, breakdown, mistakeTags: tags,
                ...(notes.trim() ? { selfNotes: notes.trim() } : {}), ...(documentId ? { documentId } : {}),
            });
            setAnalysis(created.review.analysis); setReviews((items) => [created.review, ...items]);
            setMessage(t('paperReview.saved'));
        } catch (error) { setMessage(userMessage(error, t('paperReview.saveError'))); }
        finally { setSaving(false); }
    };
    const remove = (review: ExternalPaperReview): void => {
        Alert.alert(t('paperReview.deleteTitle'), t('paperReview.deleteText'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.delete'), style: 'destructive', onPress: () => void (async () => {
                try { await deleteExternalPaperReview(review.id); setReviews((items) => items.filter((item) => item.id !== review.id)); if (analysis === review.analysis) setAnalysis(null); }
                catch (error) { setMessage(userMessage(error, t('paperReview.deleteError'))); }
            })() },
        ]);
    };

    return (
        <Screen title={t('paperReview.screenTitle')}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                <View style={styles.intro}><Text style={styles.introTitle}>{t('paperReview.heroTitle')}</Text><Text style={styles.introText}>{t('paperReview.heroText')}</Text></View>
                <Text style={styles.label}>{t('paperReview.paperTitle')}</Text><TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder={t('paperReview.titlePlaceholder')} maxLength={140} />
                <Text style={styles.label}>{t('paperReview.source')}</Text><TextInput style={styles.input} value={sourceName} onChangeText={setSourceName} placeholder={t('paperReview.sourcePlaceholder')} maxLength={120} />
                <Text style={styles.label}>{t('paperReview.testDate')}</Text><TextInput style={styles.input} value={testDate} onChangeText={setTestDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
                <View style={styles.row}><View style={styles.scoreField}><Text style={styles.label}>{t('paperReview.yourScore')}</Text><TextInput style={styles.input} value={obtainedScore} onChangeText={setObtainedScore} placeholder="0" keyboardType="decimal-pad" /></View><View style={styles.scoreField}><Text style={styles.label}>{t('paperReview.outOf')}</Text><TextInput style={styles.input} value={maxScore} onChangeText={setMaxScore} placeholder="100" keyboardType="decimal-pad" /></View></View>

                <Text style={styles.sectionTitle}>{t('paperReview.sectionMarks')}</Text>
                {sections.map((section) => <View key={section.id} style={styles.sectionRow}><TextInput style={[styles.input, styles.sectionLabel]} value={section.label} onChangeText={(value) => updateSection(section.id, { label: value })} placeholder={t('paperReview.sectionPlaceholder')} /><TextInput style={[styles.input, styles.sectionScore]} value={section.obtainedScore} onChangeText={(value) => updateSection(section.id, { obtainedScore: value })} placeholder={t('paperReview.score')} keyboardType="decimal-pad" /><TextInput style={[styles.input, styles.sectionScore]} value={section.maxScore} onChangeText={(value) => updateSection(section.id, { maxScore: value })} placeholder={t('paperReview.outOf')} keyboardType="decimal-pad" /><Pressable accessibilityRole="button" onPress={() => setSections((items) => items.filter((item) => item.id !== section.id))}><Text style={styles.remove}>{t('onboarding.remove')}</Text></Pressable></View>)}
                <Pressable style={styles.outlineButton} accessibilityRole="button" onPress={() => setSections((items) => [...items, { id: sectionId(), label: '', obtainedScore: '', maxScore: '' }])}><Text style={styles.outlineText}>{t('paperReview.addSection')}</Text></Pressable>

                <Text style={styles.sectionTitle}>{t('paperReview.whatAffected')}</Text><View style={styles.chips}>{TAGS.map((tag) => <Pressable key={tag.value} accessibilityRole="checkbox" accessibilityState={{ checked: tags.includes(tag.value) }} style={[styles.chip, tags.includes(tag.value) && styles.chipSelected]} onPress={() => toggleTag(tag.value)}><Text style={[styles.chipText, tags.includes(tag.value) && styles.chipTextSelected]}>{t(tag.label)}</Text></Pressable>)}</View>
                <Text style={styles.label}>{t('paperReview.reflection')}</Text><TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} placeholder={t('paperReview.reflectionPlaceholder')} multiline maxLength={3000} textAlignVertical="top" />
                <Pressable style={styles.outlineButton} accessibilityRole="button" disabled={uploading} onPress={() => void attachPdf()}>{uploading ? <ActivityIndicator color="#1d4ed8" /> : <Text style={styles.outlineText}>{documentName ? `${t('paperReview.attached')}: ${documentName}` : t('paperReview.attachPdf')}</Text>}</Pressable>
                <Pressable style={[styles.primaryButton, saving && styles.disabled]} accessibilityRole="button" disabled={saving} onPress={() => void save()}>{saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>{t('paperReview.createPlan')}</Text>}</Pressable>
                {message ? <Text style={styles.message}>{message}</Text> : null}
                {analysis ? <AnalysisCard analysis={analysis} /> : null}

                <Text style={styles.historyTitle}>{t('paperReview.pastReviews')}</Text>
                {loading ? <ActivityIndicator color="#2563eb" /> : reviews.length === 0 ? <Text style={styles.muted}>{t('paperReview.noReviews')}</Text> : reviews.map((review) => <View key={review.id} style={styles.historyCard}><Pressable accessibilityRole="button" onPress={() => setAnalysis(review.analysis)}><Text style={styles.historyName}>{review.title}</Text><Text style={styles.historyMeta}>{new Date(review.testDate).toLocaleDateString()} · {review.obtainedScore}/{review.maxScore} · {review.analysis.scorePercent}%</Text></Pressable><Pressable accessibilityRole="button" onPress={() => remove(review)}><Text style={styles.remove}>{t('common.delete')}</Text></Pressable></View>)}
            </ScrollView>
        </Screen>
    );
}

function AnalysisCard({ analysis }: { analysis: ExternalPaperAnalysis }): React.JSX.Element {
    const t = useTranslation();
    const forecast = analysis.forecast;
    return <View style={styles.analysis}>
        <View style={styles.analysisHero}><Text style={styles.analysisEyebrow}>{t('paperReview.eyebrow')} · {analysis.confidence.level.replace('_', ' ')}</Text><Text style={styles.analysisScore}>{analysis.scorePercent}%</Text><Text style={styles.analysisText}>{analysis.encouragement}</Text>{analysis.scoreChangePoints !== null ? <Text style={styles.analysisText}>{t('paperReview.comparedLast')}: {analysis.scoreChangePoints > 0 ? '+' : ''}{analysis.scoreChangePoints} {t('paperReview.percentagePoints')}.</Text> : null}</View>
        {analysis.documentInsights ? <View style={styles.surfacePanel}><Text style={styles.analysisHeading}>{t('paperReview.contentDetected')}</Text><Text style={styles.analysisText}>{analysis.documentInsights.message}</Text>{analysis.documentInsights.detectedTopics.slice(0, 4).map((topic) => <Text key={topic.label} style={styles.analysisText}>• {topic.label} · {topic.evidenceCount} {t('paperReview.signals')}</Text>)}<Text style={styles.disclaimer}>{analysis.documentInsights.limitation}</Text></View> : null}
        <View style={styles.warningPanel}><Text style={styles.analysisHeading}>{t('paperReview.priorities')}</Text>{analysis.priorityAreas.length ? analysis.priorityAreas.map((item) => <Text key={item.label} style={styles.analysisText}>• {item.label}: {item.scorePercent}% — {item.reason}</Text>) : <Text style={styles.analysisText}>{t('paperReview.addSectionsHint')}</Text>}</View>
        <View style={styles.surfacePanel}><Text style={styles.analysisHeading}>{t('paperReview.nextActions')}</Text>{analysis.actionPlan.map((action) => <Text key={action} style={styles.analysisText}>• {action}</Text>)}</View>
        <View style={styles.forecastPanel}><Text style={styles.analysisHeading}>{t('paperReview.nextEstimate')}</Text>{forecast.kind === 'ESTIMATE' ? <><Text style={styles.analysisTitle}>{forecast.estimatedNextMarks.low}–{forecast.estimatedNextMarks.high} / {forecast.estimatedNextMarks.maximum}</Text><Text style={styles.analysisText}>{forecast.confidence} {t('analytics.confidence')} · {t('paperReview.recentTrend')} {forecast.trendPointsPerAttempt >= 0 ? '+' : ''}{forecast.trendPointsPerAttempt} {t('paperReview.pointsPerAttempt')}</Text><Text style={styles.analysisText}>{forecast.message}</Text><Text style={styles.disclaimer}>{forecast.disclaimer}</Text></> : <Text style={styles.analysisText}>{forecast.message}</Text>}</View><Text style={styles.disclaimer}>{analysis.confidence.message} {analysis.disclaimer}</Text>
    </View>;
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 }, intro: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 14, marginBottom: 16 }, introTitle: { color: '#1e3a8a', fontWeight: '800', fontSize: 16 }, introText: { color: '#1e40af', marginTop: 5, lineHeight: 19 }, label: { color: '#374151', fontWeight: '700', marginBottom: 6, marginTop: 10 }, input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 10, color: '#111827', backgroundColor: '#ffffff' }, row: { flexDirection: 'row', gap: 10 }, scoreField: { flex: 1 }, sectionTitle: { color: '#111827', fontWeight: '800', marginTop: 18, marginBottom: 8 }, sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }, sectionLabel: { flex: 1 }, sectionScore: { width: 68 }, remove: { color: '#b91c1c', fontWeight: '700', fontSize: 12 }, outlineButton: { borderWidth: 1, borderColor: '#93c5fd', borderRadius: 9, padding: 11, alignItems: 'center', marginTop: 8 }, outlineText: { color: '#1d4ed8', fontWeight: '700' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }, chipSelected: { backgroundColor: '#dbeafe', borderColor: '#2563eb' }, chipText: { color: '#4b5563', fontSize: 12 }, chipTextSelected: { color: '#1d4ed8', fontWeight: '700' }, notes: { minHeight: 84 }, primaryButton: { backgroundColor: '#2563eb', borderRadius: 9, padding: 14, alignItems: 'center', marginTop: 14 }, primaryText: { color: '#ffffff', fontWeight: '800' }, disabled: { opacity: 0.6 }, message: { color: '#166534', marginTop: 12, lineHeight: 19 }, analysis: { marginTop: 16, gap: 10 }, analysisHero: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 14 }, analysisEyebrow: { color: '#1d4ed8', fontWeight: '800', fontSize: 11 }, analysisScore: { color: '#111827', fontWeight: '800', fontSize: 30, marginTop: 3 }, surfacePanel: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 14 }, warningPanel: { backgroundColor: '#fffbeb', borderRadius: 12, padding: 14 }, forecastPanel: { backgroundColor: '#ecfdf5', borderRadius: 12, padding: 14 }, analysisTitle: { color: '#166534', fontWeight: '800', fontSize: 17 }, analysisHeading: { color: '#166534', fontWeight: '800', marginBottom: 4 }, analysisText: { color: '#14532d', lineHeight: 20, marginTop: 4 }, disclaimer: { color: '#4b5563', fontSize: 12, lineHeight: 17, marginTop: 8 }, historyTitle: { color: '#111827', fontWeight: '800', fontSize: 17, marginTop: 24, marginBottom: 8 }, muted: { color: '#6b7280' }, historyCard: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, historyName: { color: '#111827', fontWeight: '800', maxWidth: 230 }, historyMeta: { color: '#6b7280', marginTop: 4, fontSize: 12 },
});
