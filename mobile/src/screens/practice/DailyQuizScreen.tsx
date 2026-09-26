/**
 * Daily Quiz — ten previous-year questions that change every India day.
 *
 * Loads `GET /daily-quiz`, walks the student through one question at a time, and submits once
 * to `POST /daily-quiz/submit`. Grading happens on the server (the answer key never reaches the
 * device before submission). After submission, or when reopened later the same day, it shows
 * the graded review with the correct answers, and the streak it protects.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError, getDailyQuiz, submitDailyQuiz, type DailyQuizQuestion, type DailyQuizReviewItem, type DailyQuizStreak } from '@/api';
import { Screen } from '@/components';
import { interpolate, useTranslation } from '@/localization';

const LETTERS = ['A', 'B', 'C', 'D'];

export function DailyQuizScreen(): React.JSX.Element {
    const t = useTranslation();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [available, setAvailable] = useState(true);
    const [questions, setQuestions] = useState<DailyQuizQuestion[]>([]);
    const [answers, setAnswers] = useState<Record<string, number | null>>({});
    const [index, setIndex] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [review, setReview] = useState<{ correctCount: number; totalCount: number; items: DailyQuizReviewItem[] } | null>(null);
    const [streak, setStreak] = useState<DailyQuizStreak>({ current: 0, doneToday: false });

    const load = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const quiz = await getDailyQuiz();
            setAvailable(quiz.available);
            setQuestions(quiz.questions);
            setStreak(quiz.streak);
            setReview(quiz.completed ? { correctCount: quiz.completed.correctCount, totalCount: quiz.completed.totalCount, items: quiz.completed.review } : null);
            setAnswers({});
            setIndex(0);
        } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : t('quiz.loadError'));
        } finally {
            setLoading(false);
        }
    }, [t]);
    useEffect(() => { void load(); }, [load]);

    const submit = async (): Promise<void> => {
        setSubmitting(true);
        try {
            const ids = questions.map((question) => question.id);
            const result = await submitDailyQuiz(ids, Object.fromEntries(ids.map((id) => [id, answers[id] ?? null])));
            setReview({ correctCount: result.result.correctCount, totalCount: result.result.totalCount, items: result.result.review });
            setStreak(result.streak);
        } catch (caught) {
            // 409 means another device already submitted or the quiz changed: reload to the truth.
            if (caught instanceof ApiError && caught.status === 409) { await load(); return; }
            Alert.alert(t('quiz.title'), caught instanceof ApiError ? caught.message : t('quiz.submitError'));
        } finally {
            setSubmitting(false);
        }
    };

    const confirmSubmit = (): void => {
        const unanswered = questions.filter((question) => answers[question.id] === undefined || answers[question.id] === null).length;
        if (unanswered === 0) { void submit(); return; }
        Alert.alert(t('quiz.title'), interpolate(t('quiz.unansweredWarning'), { count: unanswered }), [
            { text: t('quiz.keepAnswering'), style: 'cancel' },
            { text: t('quiz.submitAnyway'), onPress: () => void submit() },
        ]);
    };

    const streakBadge = (
        <View style={styles.streak}>
            <Text style={styles.streakText}>🔥 {streak.current > 0 ? interpolate(t('quiz.streak'), { count: streak.current }) : t('quiz.streakStart')}</Text>
        </View>
    );

    if (loading) return <Screen title={t('quiz.title')}><View style={styles.center}><ActivityIndicator size="large" color="#2563eb" /></View></Screen>;

    if (error) {
        return <Screen title={t('quiz.title')}><View style={styles.center}><Text style={styles.error}>{error}</Text><Pressable style={styles.primary} onPress={() => void load()}><Text style={styles.primaryText}>{t('common.retry')}</Text></Pressable></View></Screen>;
    }

    if (review) {
        return (
            <Screen title={t('quiz.title')}>
                <ScrollView contentContainerStyle={styles.scroll}>
                    {streakBadge}
                    <View style={styles.resultCard}>
                        <Text style={styles.resultLabel}>{t('quiz.resultTitle')}</Text>
                        <Text style={styles.resultScore}>{interpolate(t('quiz.score'), { correct: review.correctCount, total: review.totalCount })}</Text>
                        {review.correctCount < review.totalCount ? <Text style={styles.resultNote}>{t('quiz.missedToRevision')}</Text> : null}
                        <Text style={styles.resultNote}>{t('quiz.comeBackTomorrow')}</Text>
                    </View>
                    {review.items.map((item, itemIndex) => (
                        <View key={item.id} style={styles.reviewCard}>
                            <View style={styles.reviewTop}>
                                <Text style={styles.meta}>{itemIndex + 1}. {interpolate(t('quiz.pyqYear'), { year: item.year })}</Text>
                                <Text style={[styles.outcome, item.outcome === 'CORRECT' ? styles.outcomeCorrect : item.outcome === 'INCORRECT' ? styles.outcomeWrong : styles.outcomeSkipped]}>
                                    {item.outcome === 'CORRECT' ? t('quiz.correct') : item.outcome === 'INCORRECT' ? t('quiz.incorrect') : t('quiz.unanswered')}
                                </Text>
                            </View>
                            <Text style={styles.question}>{item.questionText}</Text>
                            {item.options.map((option, optionIndex) => (
                                <View key={optionIndex} style={[styles.option, optionIndex === item.correctOption && styles.optionCorrect, optionIndex === item.selectedOption && optionIndex !== item.correctOption && styles.optionWrong]}>
                                    <Text style={styles.optionText}>{LETTERS[optionIndex]}. {option}</Text>
                                    {optionIndex === item.correctOption ? <Text style={styles.optionTag}>{t('quiz.correctAnswer')}</Text> : optionIndex === item.selectedOption ? <Text style={styles.optionTag}>{t('quiz.yourAnswer')}</Text> : null}
                                </View>
                            ))}
                        </View>
                    ))}
                </ScrollView>
            </Screen>
        );
    }

    if (!available || questions.length === 0) {
        return (
            <Screen title={t('quiz.title')}>
                {streakBadge}
                <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>{t('quiz.unavailableTitle')}</Text>
                    <Text style={styles.emptyText}>{t('quiz.unavailableText')}</Text>
                </View>
            </Screen>
        );
    }

    const current = questions[index]!;
    const isLast = index === questions.length - 1;
    return (
        <Screen title={t('quiz.title')}>
            <ScrollView contentContainerStyle={styles.scroll}>
                {streakBadge}
                <Text style={styles.subtitle}>{t('quiz.subtitle')}</Text>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${((index + 1) / questions.length) * 100}%` }]} /></View>
                <Text style={styles.meta}>{interpolate(t('quiz.questionOf'), { current: index + 1, total: questions.length })} · {interpolate(t('quiz.pyqYear'), { year: current.year })}</Text>
                <Text style={styles.question}>{current.questionText}</Text>
                {current.options.map((option, optionIndex) => {
                    const selected = answers[current.id] === optionIndex;
                    return (
                        <Pressable key={optionIndex} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.option, selected && styles.optionSelected]} onPress={() => setAnswers((previous) => ({ ...previous, [current.id]: selected ? null : optionIndex }))}>
                            <Text style={styles.optionText}>{LETTERS[optionIndex]}. {option}</Text>
                        </Pressable>
                    );
                })}
                <View style={styles.row}>
                    <Pressable style={[styles.secondary, index === 0 && styles.disabled]} disabled={index === 0} onPress={() => setIndex((value) => Math.max(0, value - 1))}>
                        <Text style={styles.secondaryText}>{t('common.back')}</Text>
                    </Pressable>
                    {isLast ? (
                        <Pressable style={[styles.primary, styles.grow, submitting && styles.disabled]} disabled={submitting} onPress={confirmSubmit}>
                            <Text style={styles.primaryText}>{submitting ? t('quiz.submitting') : t('quiz.submit')}</Text>
                        </Pressable>
                    ) : (
                        <Pressable style={[styles.primary, styles.grow]} onPress={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}>
                            <Text style={styles.primaryText}>{t('common.next')}</Text>
                        </Pressable>
                    )}
                </View>
            </ScrollView>
        </Screen>
    );
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    error: { color: '#b91c1c', textAlign: 'center', lineHeight: 20 },
    streak: { alignSelf: 'flex-start', backgroundColor: '#fff7ed', borderColor: '#fed7aa', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10 },
    streakText: { color: '#9a3412', fontWeight: '800' },
    subtitle: { color: '#64748b', marginBottom: 10 },
    progressTrack: { height: 6, backgroundColor: '#e2e8f0', borderRadius: 99, overflow: 'hidden', marginBottom: 10 },
    progressFill: { height: '100%', backgroundColor: '#2563eb' },
    meta: { color: '#64748b', fontSize: 12, fontWeight: '700' },
    question: { color: '#0f172a', fontSize: 17, fontWeight: '700', lineHeight: 25, marginVertical: 12 },
    option: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 13, marginBottom: 9, backgroundColor: '#fff' },
    optionSelected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
    optionCorrect: { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
    optionWrong: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
    optionText: { color: '#1f2937', lineHeight: 21 },
    optionTag: { color: '#475569', fontSize: 11, fontWeight: '800', marginTop: 4, textTransform: 'uppercase' },
    row: { flexDirection: 'row', gap: 10, marginTop: 14 },
    grow: { flex: 1 },
    primary: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', marginTop: 12 },
    primaryText: { color: '#fff', fontWeight: '800' },
    secondary: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', marginTop: 12 },
    secondaryText: { color: '#1d4ed8', fontWeight: '800' },
    disabled: { opacity: 0.5 },
    resultCard: { backgroundColor: '#172554', borderRadius: 16, padding: 18, marginBottom: 14 },
    resultLabel: { color: '#bfdbfe', fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
    resultScore: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 6 },
    resultNote: { color: '#dbeafe', marginTop: 8, lineHeight: 20 },
    reviewCard: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 14, marginBottom: 12, backgroundColor: '#fff' },
    reviewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    outcome: { fontSize: 12, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
    outcomeCorrect: { color: '#166534', backgroundColor: '#dcfce7' },
    outcomeWrong: { color: '#991b1b', backgroundColor: '#fee2e2' },
    outcomeSkipped: { color: '#475569', backgroundColor: '#f1f5f9' },
    emptyCard: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 1, borderRadius: 14, padding: 16 },
    emptyTitle: { color: '#0f172a', fontSize: 17, fontWeight: '800' },
    emptyText: { color: '#475569', marginTop: 6, lineHeight: 21 },
});
