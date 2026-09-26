import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { createConceptClarification, createRevisionCard, type ConceptClarification, type ConceptMode } from '@/api/upscProduct';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';

const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;

export function ConceptCoachScreen(): React.JSX.Element {
    const t = useTranslation();
    const [concept, setConcept] = useState(''); const [confusion, setConfusion] = useState('');
    const [level, setLevel] = useState<(typeof LEVELS)[number]>('BEGINNER');
    const [result, setResult] = useState<ConceptClarification | null>(null);
    const [selected, setSelected] = useState<number | null>(null); const [showHint, setShowHint] = useState(false);
    const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);

    async function load(mode: ConceptMode): Promise<void> {
        if (!concept.trim()) { setMessage(t('conceptCoach.enterConcept')); return; }
        setBusy(true); setMessage(null); setSelected(null); setShowHint(false);
        try { setResult(await createConceptClarification({ concept: concept.trim(), confusion: confusion.trim() || undefined, level, mode })); }
        catch (error) { setMessage(error instanceof Error ? error.message : t('conceptCoach.loadError')); }
        finally { setBusy(false); }
    }

    async function saveCorrection(): Promise<void> {
        if (!result) return;
        setBusy(true);
        try {
            await createRevisionCard({ title: `${result.concept} · ${t('conceptCoachScreen.correction')}`, prompt: result.content.quiz.question, answer: result.content.quiz.explanation, tags: ['concept-coach', 'correction'] });
            setMessage(t('conceptCoach.savedRevision'));
        } catch (error) { setMessage(error instanceof Error ? error.message : t('conceptCoach.saveError')); }
        finally { setBusy(false); }
    }

    const correct = result && selected !== null ? selected === result.content.quiz.correctOption : null;
    return <Screen title={t('conceptCoach.title')}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('conceptCoach.intro')}</Text>
        <Text style={styles.label}>{t('conceptCoach.concept')}</Text>
        <TextInput value={concept} onChangeText={setConcept} style={styles.input} placeholder={t('conceptCoach.conceptPlaceholder')} maxLength={160} />
        <Text style={styles.label}>{t('conceptCoach.confusion')}</Text>
        <TextInput value={confusion} onChangeText={setConfusion} style={[styles.input, styles.multiline]} placeholder={t('conceptCoach.confusionPlaceholder')} multiline maxLength={1000} />
        <View style={styles.chips}>{LEVELS.map((item) => <Pressable key={item} style={[styles.chip, level === item && styles.chipActive]} onPress={() => setLevel(item)}><Text style={[styles.chipText, level === item && styles.chipTextActive]}>{t(`conceptCoach.level.${item.toLowerCase()}` as never)}</Text></Pressable>)}</View>
        <Pressable disabled={busy} style={[styles.primary, busy && styles.disabled]} onPress={() => void load('EXPLAIN')}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t('conceptCoach.explain')}</Text>}</Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {result ? <>
            <View style={styles.card}><View style={styles.cardHeader}><Text style={styles.heading}>{result.concept}</Text><Text style={styles.source}>{result.source === 'AI' ? t('conceptCoach.ai') : t('conceptCoach.curated')}</Text></View><Text style={styles.body}>{result.content.explanation}</Text>{result.content.keyPoints.map((point) => <Text key={point} style={styles.point}>• {point}</Text>)}</View>
            <View style={styles.actionRow}><Pressable style={styles.secondary} onPress={() => void load('SIMPLIFY')}><Text style={styles.secondaryText}>{t('conceptCoach.simpler')}</Text></Pressable><Pressable style={styles.secondary} onPress={() => void load('ANALOGY')}><Text style={styles.secondaryText}>{t('conceptCoach.analogyAction')}</Text></Pressable></View>
            <View style={styles.card}><Text style={styles.heading}>{t('conceptCoach.analogy')}</Text><Text style={styles.body}>{result.content.analogy}</Text><Text style={styles.subheading}>{t('conceptCoach.trap')}</Text><Text style={styles.body}>{result.content.commonMisconception}</Text></View>
            <View style={styles.quiz}><Text style={styles.heading}>{t('conceptCoach.check')}</Text><Text style={styles.question}>{result.content.quiz.question}</Text>{result.content.quiz.options.map((option, index) => <Pressable key={`${index}-${option}`} style={[styles.option, selected === index && styles.optionSelected, selected !== null && index === result.content.quiz.correctOption && styles.optionCorrect, selected === index && correct === false && styles.optionWrong]} onPress={() => setSelected(index)} disabled={selected !== null}><Text style={styles.optionText}>{String.fromCharCode(65 + index)}. {option}</Text></Pressable>)}
                {selected === null ? <Pressable onPress={() => setShowHint(true)}><Text style={styles.hintLink}>{t('conceptCoach.hint')}</Text></Pressable> : <View style={correct ? styles.correctBox : styles.wrongBox}><Text style={styles.feedback}>{correct ? t('conceptCoach.correct') : t('conceptCoach.retry')}</Text><Text style={styles.body}>{result.content.quiz.explanation}</Text>{!correct ? <Pressable disabled={busy} style={styles.saveButton} onPress={() => void saveCorrection()}><Text style={styles.saveText}>{t('conceptCoach.saveRevision')}</Text></Pressable> : null}</View>}
                {showHint && selected === null ? <Text style={styles.hint}>{result.content.quiz.hint}</Text> : null}
            </View>
        </> : null}
    </ScrollView></Screen>;
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 36 }, intro: { color: '#475569', lineHeight: 21, marginBottom: 14 }, label: { color: '#0f172a', fontWeight: '800', marginTop: 10, marginBottom: 6 }, input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, backgroundColor: '#fff', color: '#0f172a' }, multiline: { minHeight: 82, textAlignVertical: 'top' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginVertical: 12 }, chip: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 10 }, chipActive: { backgroundColor: '#dbeafe', borderColor: '#2563eb' }, chipText: { color: '#475569', fontSize: 12, fontWeight: '700' }, chipTextActive: { color: '#1d4ed8' }, primary: { backgroundColor: '#2563eb', borderRadius: 10, padding: 14, alignItems: 'center' }, primaryText: { color: '#fff', fontWeight: '800' }, disabled: { opacity: 0.6 }, message: { color: '#475569', marginTop: 10 }, card: { borderWidth: 1, borderColor: '#dbeafe', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 12 }, cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, heading: { color: '#0f172a', fontSize: 17, fontWeight: '800', flexShrink: 1 }, source: { color: '#1d4ed8', backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontSize: 11, overflow: 'hidden' }, body: { color: '#334155', lineHeight: 21, marginTop: 7 }, point: { color: '#334155', lineHeight: 20, marginTop: 5 }, subheading: { color: '#9a3412', fontWeight: '800', marginTop: 12 }, actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 }, secondary: { flex: 1, borderWidth: 1, borderColor: '#2563eb', borderRadius: 9, padding: 10, alignItems: 'center' }, secondaryText: { color: '#1d4ed8', fontWeight: '800' }, quiz: { borderWidth: 1, borderColor: '#bbf7d0', backgroundColor: '#f0fdf4', borderRadius: 12, padding: 14, marginTop: 12 }, question: { color: '#14532d', fontWeight: '700', lineHeight: 21, marginVertical: 9 }, option: { borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff', borderRadius: 9, padding: 11, marginTop: 7 }, optionSelected: { borderColor: '#2563eb' }, optionCorrect: { borderColor: '#16a34a', backgroundColor: '#dcfce7' }, optionWrong: { borderColor: '#dc2626', backgroundColor: '#fee2e2' }, optionText: { color: '#1f2937' }, hintLink: { color: '#1d4ed8', fontWeight: '700', marginTop: 12 }, hint: { color: '#475569', fontStyle: 'italic', marginTop: 7 }, correctBox: { borderTopWidth: 1, borderTopColor: '#bbf7d0', marginTop: 12, paddingTop: 9 }, wrongBox: { borderTopWidth: 1, borderTopColor: '#fecaca', marginTop: 12, paddingTop: 9 }, feedback: { color: '#166534', fontWeight: '800' }, saveButton: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, padding: 9, marginTop: 10 }, saveText: { color: '#1d4ed8', fontWeight: '700' },
});
