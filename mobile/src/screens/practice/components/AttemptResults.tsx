/**
 * Attempt results + flag-to-journal view for the Practice screens (task 21.6).
 *
 * Shared by PYQ practice (Req 6.2) and Timed Paper Mode (Req 19.5/19.6) to show instant
 * scoring: a total-score header plus a per-question breakdown (correct / incorrect /
 * unanswered) with the user's selection and the correct option revealed after submission.
 *
 * For every journal-eligible question (answered incorrectly or left unanswered, Req 18.3),
 * it offers an inline categorized "flag into mistake journal" control wired to
 * POST /mistakes (Req 18.1) — the source of mistakes the Mistake Journal screen then browses.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { useTranslation } from '@/localization';

import {
    MISTAKE_CATEGORY_OPTIONS,
    flagMistake,
    isFlaggable,
    type AttemptResult,
    type ClientPYQ,
    type MistakeCategory,
    type MistakeSourceType,
    type PerQuestionResult,
} from '../api';
import { Chip } from './Chip';

interface AttemptResultsProps {
    result: AttemptResult;
    /** Lookup of the practiced questions, for rendering text and option labels. */
    questionsById: Record<string, ClientPYQ>;
    /** Which attempt table this result came from (selects the journal source). */
    sourceType: MistakeSourceType;
}

type FlagStatus =
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'flagged'; category: MistakeCategory }
    | { state: 'error'; message: string };

/** Render the option text for a stringified 0-based index, or a dash when unanswered. */
function optionLabel(question: ClientPYQ | undefined, stringIndex: string | null): string {
    if (stringIndex === null) return '—';
    const index = Number(stringIndex);
    if (!Number.isInteger(index) || question === undefined) return stringIndex;
    return question.options[index] ?? stringIndex;
}

const OUTCOME_STYLE: Record<PerQuestionResult['outcome'], { label: string; color: string }> = {
    CORRECT: { label: 'Correct', color: '#16a34a' },
    INCORRECT: { label: 'Incorrect', color: '#dc2626' },
    UNANSWERED: { label: 'Unanswered', color: '#d97706' },
};

export function AttemptResults({
    result,
    questionsById,
    sourceType,
}: AttemptResultsProps): React.JSX.Element {
    const t = useTranslation();
    const [flagState, setFlagState] = useState<Record<string, FlagStatus>>({});

    const total = result.perQuestion.length;
    const summary = useMemo(
        () => `${t('pyq.score')}: ${result.totalScore} / ${total}`,
        [result.totalScore, total, t],
    );

    const onFlag = async (questionId: string, category: MistakeCategory): Promise<void> => {
        setFlagState((prev) => ({ ...prev, [questionId]: { state: 'saving' } }));
        try {
            await flagMistake({
                sourceType,
                attemptId: result.attemptId,
                questionId,
                category,
            });
            setFlagState((prev) => ({ ...prev, [questionId]: { state: 'flagged', category } }));
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : 'Could not flag this question.';
            setFlagState((prev) => ({ ...prev, [questionId]: { state: 'error', message } }));
        }
    };

    return (
        <View>
            <View style={styles.scoreBanner}>
                <Text style={styles.scoreText}>{summary}</Text>
            </View>

            {result.perQuestion.map((pq, index) => {
                const question = questionsById[pq.questionId];
                const outcome = OUTCOME_STYLE[pq.outcome];
                const status: FlagStatus = flagState[pq.questionId] ?? { state: 'idle' };
                return (
                    <View key={pq.questionId} style={styles.row}>
                        <View style={styles.rowHeader}>
                            <Text style={styles.rowTitle} numberOfLines={2}>
                                {index + 1}. {question?.questionText ?? pq.questionId}
                            </Text>
                            <Text style={[styles.badge, { color: outcome.color }]}>
                                {outcome.label}
                            </Text>
                        </View>
                        <Text style={styles.detail}>
                            Your answer: {optionLabel(question, pq.selectedOption)}
                        </Text>
                        <Text style={styles.detail}>
                            Correct answer: {optionLabel(question, pq.correctOption)}
                        </Text>

                        {isFlaggable(pq.outcome) ? (
                            <View style={styles.flagArea}>
                                {status.state === 'flagged' ? (
                                    <Text style={styles.flaggedText}>
                                        Added to {t('mistakes.title')}
                                    </Text>
                                ) : status.state === 'saving' ? (
                                    <ActivityIndicator size="small" color="#2563eb" />
                                ) : (
                                    <>
                                        <Text style={styles.flagPrompt}>
                                            Flag to {t('mistakes.title')}:
                                        </Text>
                                        <View style={styles.chipRow}>
                                            {MISTAKE_CATEGORY_OPTIONS.map((option) => (
                                                <Chip
                                                    key={option.value}
                                                    label={t(option.labelKey)}
                                                    onPress={() => onFlag(pq.questionId, option.value)}
                                                />
                                            ))}
                                        </View>
                                        {status.state === 'error' ? (
                                            <Text style={styles.errorText}>{status.message}</Text>
                                        ) : null}
                                    </>
                                )}
                            </View>
                        ) : null}
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    scoreBanner: {
        backgroundColor: '#eff6ff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    scoreText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1d4ed8',
    },
    row: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        backgroundColor: '#ffffff',
    },
    rowHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    rowTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: '#111827',
        marginRight: 8,
    },
    badge: {
        fontSize: 13,
        fontWeight: '700',
    },
    detail: {
        fontSize: 13,
        color: '#4b5563',
        marginTop: 2,
    },
    flagArea: {
        marginTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
        paddingTop: 10,
    },
    flagPrompt: {
        fontSize: 13,
        color: '#6b7280',
        marginBottom: 6,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    flaggedText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#16a34a',
    },
    errorText: {
        fontSize: 13,
        color: '#dc2626',
        marginTop: 4,
    },
});
