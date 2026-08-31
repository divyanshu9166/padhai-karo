import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import type { PracticeStackScreenProps } from '@/navigation/types';
import { saveMock, startMock, submitMock, type MockAttempt, type MockQuestion, type MockScore, type MockScoring } from '@/api/upscProduct';

export function MockExamScreen({ navigation }: PracticeStackScreenProps<'Mock'>): React.JSX.Element {
    const t = useTranslation();
    const [attempt, setAttempt] = useState<MockAttempt | null>(null);
    const [questions, setQuestions] = useState<MockQuestion[]>([]);
    const [answers, setAnswers] = useState<Record<string, number | null>>({});
    const [marked, setMarked] = useState<string[]>([]);
    const [index, setIndex] = useState(0);
    const [message, setMessage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [remainingSec, setRemainingSec] = useState<number | null>(null);
    const [sectionRemainingSec, setSectionRemainingSec] = useState<number | null>(null);
    const [activeSection, setActiveSection] = useState<string | null>(null);
    const [scoring, setScoring] = useState<MockScoring | null>(null);
    const [resultScore, setResultScore] = useState<MockScore | null>(null);
    const [officialPaperUnavailable, setOfficialPaperUnavailable] = useState(false);
    const submittedRef = useRef(false);

    useEffect(() => { void (async () => { try { const result = await startMock(); setAttempt(result.attempt); setQuestions(result.questions); setScoring(result.scoring ?? null); const firstSection = Object.keys(result.attempt.sectionTimings ?? {}).find((key) => key !== '__meta') ?? null; setActiveSection(firstSection); setSectionRemainingSec(firstSection ? result.attempt.sectionTimings?.[firstSection]?.durationSec ?? null : null); } catch (error) { setOfficialPaperUnavailable(error instanceof ApiError && (error.status === 404 || error.status === 409)); setMessage(error instanceof ApiError ? error.message : t('practice.noMock')); } finally { setLoading(false); } })(); }, [t]);
    const sectionIds = useMemo(() => Object.keys(attempt?.sectionTimings ?? {}).filter((key) => key !== '__meta'), [attempt]);
    const visibleQuestions = useMemo(() => activeSection ? questions.filter((question) => question.subjectId === activeSection) : questions, [activeSection, questions]);
    const sectionDeadline = useMemo(() => {
        if (!attempt?.createdAt || !activeSection) return null;
        const createdAt = new Date(attempt.createdAt).getTime();
        if (!Number.isFinite(createdAt)) return null;
        const sectionIndex = sectionIds.indexOf(activeSection);
        const elapsedBefore = sectionIds.slice(0, Math.max(0, sectionIndex)).reduce((sum, id) => sum + (attempt.sectionTimings?.[id]?.durationSec ?? 0), 0);
        const duration = attempt.sectionTimings?.[activeSection]?.durationSec ?? 0;
        return createdAt + (elapsedBefore + duration) * 1000;
    }, [activeSection, attempt, sectionIds]);
    const current = visibleQuestions[index];
    const choose = (option: number): void => { if (!current || attempt?.status !== 'IN_PROGRESS') return; setAnswers((previous) => ({ ...previous, [current.id]: option })); };
    const toggleMark = (): void => { if (!current) return; setMarked((previous) => previous.includes(current.id) ? previous.filter((id) => id !== current.id) : [...previous, current.id]); };
    const save = async (): Promise<void> => { if (!attempt) return; try { await saveMock(attempt.id, { answers, markedForReview: marked, currentQuestion: index }); setMessage(t('practice.progressSaved')); } catch (error) { setMessage(error instanceof ApiError ? error.message : t('practice.mockProgressError')); } };
    const submit = useCallback(async (): Promise<void> => { if (!attempt || submittedRef.current || attempt.status !== 'IN_PROGRESS') return; submittedRef.current = true; try { const result = await submitMock(attempt.id, answers); setAttempt(result.attempt); setResultScore(result.score ?? null); setMessage(`${t('practice.mockSubmitSuccess')}: ${result.scorePercent}%`); } catch (error) { submittedRef.current = false; setMessage(error instanceof ApiError ? error.message : t('practice.mockSubmitError')); } }, [answers, attempt, t]);

    useEffect(() => {
        if (!attempt || attempt.status !== 'IN_PROGRESS') return;
        const createdAt = attempt.createdAt ? new Date(attempt.createdAt).getTime() : NaN;
        const deadline = Number.isFinite(createdAt) ? createdAt + attempt.durationSec * 1000 : Date.now() + attempt.durationSec * 1000;
        const update = (): void => {
            const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            setRemainingSec(next);
            if (next <= 0) void submit();
        };
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [attempt, submit]);

    useEffect(() => {
        if (!attempt || attempt.status !== 'IN_PROGRESS' || sectionRemainingSec === null) return;
        const update = (): void => {
            const nextRemaining = sectionDeadline ? Math.max(0, Math.ceil((sectionDeadline - Date.now()) / 1000)) : Math.max(0, sectionRemainingSec - 1);
            setSectionRemainingSec(nextRemaining);
            if (nextRemaining > 0) return;
            const next = sectionIds[sectionIds.indexOf(activeSection ?? '') + 1];
            if (next) { setSectionRemainingSec(attempt.sectionTimings?.[next]?.durationSec ?? null); setActiveSection(next); setIndex(0); }
            else void submit();
        };
        if (sectionRemainingSec <= 0) update();
        else { const timer = setInterval(update, 1000); return () => clearInterval(timer); }
    }, [activeSection, attempt, sectionDeadline, sectionIds, sectionRemainingSec, submit]);

    if (loading) return <Screen title={t('practice.mockTitle')}><ActivityIndicator color="#2563eb" /></Screen>;
    return <Screen title={t('practice.mockTitle')}><ScrollView contentContainerStyle={styles.scroll}>{message ? <Text style={officialPaperUnavailable ? styles.errorMessage : styles.message}>{message}</Text> : null}{officialPaperUnavailable ? <View style={styles.unavailable}><Text style={styles.unavailableTitle}>Official full mock is not ready yet</Text><Text style={styles.unavailableText}>A verified, complete paper is required before this mode starts. You can still keep your preparation moving with a timed paper or by reviewing marks from an external test.</Text><View style={styles.row}><Pressable style={styles.secondary} onPress={() => navigation.navigate('TimedPaper')}><Text style={styles.secondaryText}>Try timed paper</Text></Pressable><Pressable style={styles.secondary} onPress={() => navigation.navigate('ExternalPaperReview')}><Text style={styles.secondaryText}>Review external paper</Text></Pressable></View></View> : null}{scoring ? <Text style={styles.scoring}>{t('practice.officialScoring')}: {scoring.marksPerQuestion} marks/question · {formatNegative(scoring)} negative</Text> : null}{resultScore ? <View style={styles.result}><Text style={styles.resultTitle}>{t('practice.result')}</Text><Text style={styles.resultText}>{resultScore.obtainedScore} / {resultScore.maximumScore} marks · {resultScore.correctCount} correct · {resultScore.incorrectCount} incorrect · {resultScore.unansweredCount} unanswered</Text></View> : null}{!current && !officialPaperUnavailable ? <Text style={styles.muted}>{t('practice.noOfficialQuestions')}</Text> : current ? <><View style={styles.sectionTabs}>{sectionIds.map((sectionId) => <Pressable key={sectionId} style={[styles.sectionTab, activeSection === sectionId && styles.sectionTabActive]} disabled><Text style={styles.sectionTabText}>{sectionId}</Text></Pressable>)}</View><View style={styles.meta}><Text style={styles.metaText}>{t('practice.question')} {index + 1} of {visibleQuestions.length}</Text><Text style={styles.metaText}>{marked.length} {t('practice.markedForReview')}</Text></View><Text style={styles.timer}>{attempt?.status === 'IN_PROGRESS' && remainingSec !== null ? `Total ${formatTimer(remainingSec)}` : t('practice.submit')}</Text><Text style={styles.section}>Section: {current.subjectId} · {current.year} · {sectionRemainingSec !== null ? `Section ${formatTimer(sectionRemainingSec)}` : ''}</Text><Text style={styles.question}>{current.questionText}</Text>{current.options.map((option, optionIndex) => <Pressable key={optionIndex} style={[styles.option, answers[current.id] === optionIndex && styles.selected]} onPress={() => choose(optionIndex)} disabled={attempt?.status !== 'IN_PROGRESS'}><Text style={styles.optionText}>{String.fromCharCode(65 + optionIndex)}. {option}</Text></Pressable>)}<View style={styles.row}><Pressable style={styles.secondary} onPress={toggleMark} disabled={attempt?.status !== 'IN_PROGRESS'}><Text style={styles.secondaryText}>{marked.includes(current.id) ? t('practice.unmark') : t('practice.markForReview')}</Text></Pressable><Pressable style={styles.secondary} onPress={() => void save()} disabled={attempt?.status !== 'IN_PROGRESS'}><Text style={styles.secondaryText}>{t('practice.saveProgress')}</Text></Pressable></View><View style={styles.row}><Pressable style={styles.secondary} disabled={index === 0} onPress={() => setIndex((value) => Math.max(0, value - 1))}><Text style={styles.secondaryText}>{t('practice.previous')}</Text></Pressable><Pressable style={styles.secondary} disabled={index === visibleQuestions.length - 1} onPress={() => setIndex((value) => Math.min(visibleQuestions.length - 1, value + 1))}><Text style={styles.secondaryText}>{t('practice.next')}</Text></Pressable></View><Pressable style={styles.submit} onPress={() => void submit()} disabled={attempt?.status !== 'IN_PROGRESS'}><Text style={styles.submitText}>{t('practice.submitMock')}</Text></Pressable></> : null}</ScrollView></Screen>;
}

function formatTimer(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function formatNegative(scoring: MockScoring): string { return scoring.negativeMarking.kind === 'FIXED_MARKS' ? `${scoring.negativeMarking.marks ?? 0} marks` : scoring.negativeMarking.kind === 'FRACTION_OF_QUESTION_MARKS' ? `${Math.round((scoring.negativeMarking.fraction ?? 0) * 100)}% of marks` : 'none'; }

const styles = StyleSheet.create({ scroll: { paddingBottom: 32 }, message: { color: '#15803d', marginBottom: 12 }, errorMessage: { color: '#b45309', marginBottom: 12 }, unavailable: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 10, padding: 13, marginBottom: 12 }, unavailableTitle: { color: '#92400e', fontWeight: '800', fontSize: 16 }, unavailableText: { color: '#78350f', marginTop: 5, lineHeight: 20 }, muted: { color: '#6b7280', textAlign: 'center', marginTop: 20 }, scoring: { color: '#6b7280', fontSize: 12, marginBottom: 8 }, result: { backgroundColor: '#ecfdf5', borderRadius: 10, padding: 12, marginBottom: 10 }, resultTitle: { color: '#166534', fontWeight: '800' }, resultText: { color: '#166534', marginTop: 4, lineHeight: 20 }, sectionTabs: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }, sectionTab: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 7, padding: 8, marginRight: 6, marginBottom: 6 }, sectionTabActive: { borderColor: '#2563eb', backgroundColor: '#eff6ff' }, sectionTabText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' }, meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }, metaText: { color: '#6b7280', fontSize: 12 }, timer: { alignSelf: 'flex-end', backgroundColor: '#111827', color: '#fff', borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6, fontWeight: '800', marginBottom: 8 }, section: { color: '#6b7280', fontSize: 12, marginBottom: 8 }, question: { fontSize: 18, fontWeight: '800', lineHeight: 25, color: '#111827', marginBottom: 12 }, option: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, marginBottom: 8 }, selected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' }, optionText: { color: '#374151', lineHeight: 20 }, row: { flexDirection: 'row', flexWrap: 'wrap' }, secondary: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, padding: 10, marginRight: 8, marginTop: 8 }, secondaryText: { color: '#2563eb', fontWeight: '700' }, submit: { backgroundColor: '#2563eb', borderRadius: 8, padding: 13, alignItems: 'center', marginTop: 16 }, submitText: { color: '#fff', fontWeight: '700' } });
