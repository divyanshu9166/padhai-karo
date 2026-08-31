import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
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

const TAGS: Array<{ value: ExternalPaperMistakeTag; label: string }> = [
    { value: 'CONCEPT_GAP', label: 'Concept gap' },
    { value: 'SILLY_MISTAKE', label: 'Silly mistake' },
    { value: 'TIME_PRESSURE', label: 'Time pressure' },
    { value: 'REVISION_GAP', label: 'Revision gap' },
    { value: 'UNATTEMPTED', label: 'Unattempted' },
];

function today(): string { return new Date().toISOString().slice(0, 10); }
function sectionId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function userMessage(error: unknown, fallback: string): string { return error instanceof ApiError ? error.message : fallback; }

/** A supportive review flow for papers attempted outside the app, without outcome predictions. */
export function ExternalPaperReviewScreen(): React.JSX.Element {
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
        catch (error) { setMessage(userMessage(error, 'Could not load previous paper reviews.')); }
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
            setMessage(uploaded.searchable ? 'Paper attached. Its text is searchable in Library too.' : 'Paper attached for reference.');
        } catch (error) { setMessage(userMessage(error, 'Could not attach this PDF.')); }
        finally { setUploading(false); }
    };
    const save = async (): Promise<void> => {
        const score = Number(obtainedScore); const maximum = Number(maxScore);
        if (!title.trim() || !Number.isFinite(score) || !Number.isFinite(maximum)) {
            setMessage('Add a title, your score, and the maximum score.'); return;
        }
        const breakdown: ExternalPaperBreakdown[] = [];
        for (const section of sections) {
            const sectionScore = Number(section.obtainedScore); const sectionMaximum = Number(section.maxScore);
            if (!section.label.trim() || !Number.isFinite(sectionScore) || !Number.isFinite(sectionMaximum)) {
                setMessage('Complete each section row, or remove the unfinished row.'); return;
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
            setMessage('Review saved. Use the action plan for your next few study blocks.');
        } catch (error) { setMessage(userMessage(error, 'Could not save this paper review.')); }
        finally { setSaving(false); }
    };
    const remove = (review: ExternalPaperReview): void => {
        Alert.alert('Delete paper review?', 'This removes its linked self-reported analytics point too.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => void (async () => {
                try { await deleteExternalPaperReview(review.id); setReviews((items) => items.filter((item) => item.id !== review.id)); if (analysis === review.analysis) setAnalysis(null); }
                catch (error) { setMessage(userMessage(error, 'Could not delete this review.')); }
            })() },
        ]);
    };

    return (
        <Screen title="Review external paper">
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                <View style={styles.intro}><Text style={styles.introTitle}>Turn a paper into the next right study steps</Text><Text style={styles.introText}>Add marks from any coaching or self-test. This is a study review, not a rank or selection prediction.</Text></View>
                <Text style={styles.label}>Paper title</Text><TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. UPSC GS Paper 1 mock" maxLength={140} />
                <Text style={styles.label}>Source (optional)</Text><TextInput style={styles.input} value={sourceName} onChangeText={setSourceName} placeholder="Coaching or self-test" maxLength={120} />
                <Text style={styles.label}>Test date</Text><TextInput style={styles.input} value={testDate} onChangeText={setTestDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
                <View style={styles.row}><View style={styles.scoreField}><Text style={styles.label}>Your score</Text><TextInput style={styles.input} value={obtainedScore} onChangeText={setObtainedScore} placeholder="0" keyboardType="decimal-pad" /></View><View style={styles.scoreField}><Text style={styles.label}>Out of</Text><TextInput style={styles.input} value={maxScore} onChangeText={setMaxScore} placeholder="100" keyboardType="decimal-pad" /></View></View>

                <Text style={styles.sectionTitle}>Section-wise marks (optional)</Text>
                {sections.map((section) => <View key={section.id} style={styles.sectionRow}><TextInput style={[styles.input, styles.sectionLabel]} value={section.label} onChangeText={(value) => updateSection(section.id, { label: value })} placeholder="Section, e.g. Quant" /><TextInput style={[styles.input, styles.sectionScore]} value={section.obtainedScore} onChangeText={(value) => updateSection(section.id, { obtainedScore: value })} placeholder="Score" keyboardType="decimal-pad" /><TextInput style={[styles.input, styles.sectionScore]} value={section.maxScore} onChangeText={(value) => updateSection(section.id, { maxScore: value })} placeholder="Out of" keyboardType="decimal-pad" /><Pressable accessibilityRole="button" onPress={() => setSections((items) => items.filter((item) => item.id !== section.id))}><Text style={styles.remove}>Remove</Text></Pressable></View>)}
                <Pressable style={styles.outlineButton} accessibilityRole="button" onPress={() => setSections((items) => [...items, { id: sectionId(), label: '', obtainedScore: '', maxScore: '' }])}><Text style={styles.outlineText}>+ Add section</Text></Pressable>

                <Text style={styles.sectionTitle}>What affected this paper?</Text><View style={styles.chips}>{TAGS.map((tag) => <Pressable key={tag.value} accessibilityRole="checkbox" accessibilityState={{ checked: tags.includes(tag.value) }} style={[styles.chip, tags.includes(tag.value) && styles.chipSelected]} onPress={() => toggleTag(tag.value)}><Text style={[styles.chipText, tags.includes(tag.value) && styles.chipTextSelected]}>{tag.label}</Text></Pressable>)}</View>
                <Text style={styles.label}>Reflection (optional)</Text><TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} placeholder="What felt difficult? What will you change next time?" multiline maxLength={3000} textAlignVertical="top" />
                <Pressable style={styles.outlineButton} accessibilityRole="button" disabled={uploading} onPress={() => void attachPdf()}>{uploading ? <ActivityIndicator color="#1d4ed8" /> : <Text style={styles.outlineText}>{documentName ? `Attached: ${documentName}` : 'Attach paper PDF (optional)'}</Text>}</Pressable>
                <Pressable style={[styles.primaryButton, saving && styles.disabled]} accessibilityRole="button" disabled={saving} onPress={() => void save()}>{saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>Create action plan</Text>}</Pressable>
                {message ? <Text style={styles.message}>{message}</Text> : null}
                {analysis ? <AnalysisCard analysis={analysis} /> : null}

                <Text style={styles.historyTitle}>Past reviews</Text>
                {loading ? <ActivityIndicator color="#2563eb" /> : reviews.length === 0 ? <Text style={styles.muted}>No saved paper reviews yet.</Text> : reviews.map((review) => <View key={review.id} style={styles.historyCard}><Pressable accessibilityRole="button" onPress={() => setAnalysis(review.analysis)}><Text style={styles.historyName}>{review.title}</Text><Text style={styles.historyMeta}>{new Date(review.testDate).toLocaleDateString()} · {review.obtainedScore}/{review.maxScore} · {review.analysis.scorePercent}%</Text></Pressable><Pressable accessibilityRole="button" onPress={() => remove(review)}><Text style={styles.remove}>Delete</Text></Pressable></View>)}
            </ScrollView>
        </Screen>
    );
}

function AnalysisCard({ analysis }: { analysis: ExternalPaperAnalysis }): React.JSX.Element {
    return <View style={styles.analysis}><Text style={styles.analysisTitle}>{analysis.scorePercent}% paper review</Text><Text style={styles.analysisText}>{analysis.encouragement}</Text>{analysis.scoreChangePoints !== null ? <Text style={styles.analysisText}>Compared with your last reviewed paper: {analysis.scoreChangePoints > 0 ? '+' : ''}{analysis.scoreChangePoints} percentage points.</Text> : null}<Text style={styles.analysisHeading}>Priorities</Text>{analysis.priorityAreas.length ? analysis.priorityAreas.map((item) => <Text key={item.label} style={styles.analysisText}>• {item.label}: {item.scorePercent}% — {item.reason}</Text>) : <Text style={styles.analysisText}>Add section-wise marks next time for targeted priorities.</Text>}<Text style={styles.analysisHeading}>Next actions</Text>{analysis.actionPlan.map((action) => <Text key={action} style={styles.analysisText}>• {action}</Text>)}<Text style={styles.disclaimer}>{analysis.confidence.message} {analysis.disclaimer}</Text></View>;
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 }, intro: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 14, marginBottom: 16 }, introTitle: { color: '#1e3a8a', fontWeight: '800', fontSize: 16 }, introText: { color: '#1e40af', marginTop: 5, lineHeight: 19 }, label: { color: '#374151', fontWeight: '700', marginBottom: 6, marginTop: 10 }, input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 10, color: '#111827', backgroundColor: '#ffffff' }, row: { flexDirection: 'row', gap: 10 }, scoreField: { flex: 1 }, sectionTitle: { color: '#111827', fontWeight: '800', marginTop: 18, marginBottom: 8 }, sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }, sectionLabel: { flex: 1 }, sectionScore: { width: 68 }, remove: { color: '#b91c1c', fontWeight: '700', fontSize: 12 }, outlineButton: { borderWidth: 1, borderColor: '#93c5fd', borderRadius: 9, padding: 11, alignItems: 'center', marginTop: 8 }, outlineText: { color: '#1d4ed8', fontWeight: '700' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }, chipSelected: { backgroundColor: '#dbeafe', borderColor: '#2563eb' }, chipText: { color: '#4b5563', fontSize: 12 }, chipTextSelected: { color: '#1d4ed8', fontWeight: '700' }, notes: { minHeight: 84 }, primaryButton: { backgroundColor: '#2563eb', borderRadius: 9, padding: 14, alignItems: 'center', marginTop: 14 }, primaryText: { color: '#ffffff', fontWeight: '800' }, disabled: { opacity: 0.6 }, message: { color: '#166534', marginTop: 12, lineHeight: 19 }, analysis: { backgroundColor: '#ecfdf5', borderRadius: 12, padding: 14, marginTop: 16 }, analysisTitle: { color: '#166534', fontWeight: '800', fontSize: 17 }, analysisHeading: { color: '#166534', fontWeight: '800', marginTop: 12, marginBottom: 4 }, analysisText: { color: '#14532d', lineHeight: 20, marginTop: 4 }, disclaimer: { color: '#4b5563', fontSize: 12, lineHeight: 17, marginTop: 12 }, historyTitle: { color: '#111827', fontWeight: '800', fontSize: 17, marginTop: 24, marginBottom: 8 }, muted: { color: '#6b7280' }, historyCard: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, historyName: { color: '#111827', fontWeight: '800', maxWidth: 230 }, historyMeta: { color: '#6b7280', marginTop: 4, fontSize: 12 },
});
