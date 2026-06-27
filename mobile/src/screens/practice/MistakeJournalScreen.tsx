/**
 * Mistake Journal screen (task 21.6; Req 18.1, 18.5, 18.6).
 *
 * Browses the user's categorized Mistake Journal (GET /mistakes), filterable by subject and/or
 * Mistake_Category. Entries are created elsewhere — from the PYQ and Timed Paper results views,
 * which flag wrong/unreached questions via POST /mistakes (Req 18.1). Each entry shows its
 * category, source, and the submitted vs. correct option index.
 *
 * Subject filter options are loaded for the user's Exam_Track (a subject's reference key is the
 * `subjectId` the journal query expects).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';

import {
    MISTAKE_CATEGORY_OPTIONS,
    getProfileTrack,
    listMistakes,
    listSubjects,
    type MistakeCategory,
    type MistakeEntry,
    type ReferenceSubject,
} from './api';
import { Chip } from './components/Chip';

type LoadState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; entries: MistakeEntry[] };

export function MistakeJournalScreen(): React.JSX.Element {
    const t = useTranslation();

    const [subjects, setSubjects] = useState<ReferenceSubject[]>([]);
    const [subjectsReady, setSubjectsReady] = useState(false);
    const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<MistakeCategory | null>(null);
    const [state, setState] = useState<LoadState>({ kind: 'loading' });

    const subjectName = useMemo<Record<string, string>>(() => {
        const map: Record<string, string> = {};
        for (const s of subjects) map[s.key] = s.name;
        return map;
    }, [subjects]);

    const loadEntries = useCallback(async (): Promise<void> => {
        setState({ kind: 'loading' });
        try {
            const entries = await listMistakes({
                subjectId: subjectFilter,
                category: categoryFilter,
            });
            setState({ kind: 'ready', entries });
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : 'Could not load the journal. Try again.';
            setState({ kind: 'error', message });
        }
    }, [subjectFilter, categoryFilter]);

    // Load subject options once (best-effort: the journal still works without them).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const track = await getProfileTrack();
                const list = await listSubjects(track);
                if (!cancelled) setSubjects(list);
            } catch {
                // Subjects are an optional filter aid; ignore failures.
            } finally {
                if (!cancelled) setSubjectsReady(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // (Re)load entries whenever the filters change.
    useEffect(() => {
        void loadEntries();
    }, [loadEntries]);

    const categoryLabel = useCallback(
        (category: MistakeCategory): string => {
            const option = MISTAKE_CATEGORY_OPTIONS.find((o) => o.value === category);
            return option ? t(option.labelKey) : category;
        },
        [t],
    );

    return (
        <Screen title={t('mistakes.title')}>
            <View style={styles.filters}>
                {subjects.length > 0 ? (
                    <>
                        <Text style={styles.filterLabel}>{t('pyq.filterBySubject')}</Text>
                        <View style={styles.chipRow}>
                            <Chip
                                label="All"
                                selected={subjectFilter === null}
                                onPress={() => setSubjectFilter(null)}
                            />
                            {subjects.map((s) => (
                                <Chip
                                    key={s.key}
                                    label={s.name}
                                    selected={subjectFilter === s.key}
                                    onPress={() =>
                                        setSubjectFilter((cur) => (cur === s.key ? null : s.key))
                                    }
                                />
                            ))}
                        </View>
                    </>
                ) : null}

                <Text style={styles.filterLabel}>Category</Text>
                <View style={styles.chipRow}>
                    <Chip
                        label="All"
                        selected={categoryFilter === null}
                        onPress={() => setCategoryFilter(null)}
                    />
                    {MISTAKE_CATEGORY_OPTIONS.map((option) => (
                        <Chip
                            key={option.value}
                            label={t(option.labelKey)}
                            selected={categoryFilter === option.value}
                            onPress={() =>
                                setCategoryFilter((cur) =>
                                    cur === option.value ? null : option.value,
                                )
                            }
                        />
                    ))}
                </View>
            </View>

            {state.kind === 'loading' || !subjectsReady ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#2563eb" />
                </View>
            ) : state.kind === 'error' ? (
                <View style={styles.centered}>
                    <Text style={styles.error}>{state.message}</Text>
                    <Pressable
                        onPress={() => void loadEntries()}
                        accessibilityRole="button"
                        style={styles.retryButton}
                    >
                        <Text style={styles.retryText}>{t('common.retry')}</Text>
                    </Pressable>
                </View>
            ) : state.entries.length === 0 ? (
                <View style={styles.centered}>
                    <Text style={styles.muted}>
                        No entries yet. Flag a wrong answer from a practice set or timed paper to
                        start your journal.
                    </Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.scroll}>
                    {state.entries.map((entry) => (
                        <View key={entry.id} style={styles.entry}>
                            <View style={styles.entryHeader}>
                                <Text style={styles.entryCategory}>
                                    {categoryLabel(entry.category)}
                                </Text>
                                <Text style={styles.entrySource}>{entry.sourceType}</Text>
                            </View>
                            <Text style={styles.entryDetail}>
                                Subject: {subjectName[entry.subjectId] ?? entry.subjectId}
                            </Text>
                            <Text style={styles.entryDetail}>
                                Your answer:{' '}
                                {entry.submittedAnswer === null
                                    ? '—'
                                    : `Option ${entry.submittedAnswer + 1}`}
                                {'   '}Correct: Option {entry.correctAnswer + 1}
                            </Text>
                            {entry.note ? (
                                <Text style={styles.entryNote}>{entry.note}</Text>
                            ) : null}
                        </View>
                    ))}
                </ScrollView>
            )}
        </Screen>
    );
}

const styles = StyleSheet.create({
    filters: {
        marginBottom: 8,
    },
    filterLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginTop: 8,
        marginBottom: 8,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    scroll: {
        paddingBottom: 32,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    muted: {
        fontSize: 14,
        color: '#6b7280',
        textAlign: 'center',
        lineHeight: 20,
    },
    error: {
        fontSize: 14,
        color: '#dc2626',
        marginBottom: 12,
        textAlign: 'center',
    },
    retryButton: {
        paddingVertical: 10,
        paddingHorizontal: 20,
    },
    retryText: {
        color: '#2563eb',
        fontSize: 15,
        fontWeight: '600',
    },
    entry: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        backgroundColor: '#ffffff',
    },
    entryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    entryCategory: {
        fontSize: 15,
        fontWeight: '700',
        color: '#111827',
    },
    entrySource: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6b7280',
    },
    entryDetail: {
        fontSize: 13,
        color: '#4b5563',
        marginTop: 2,
    },
    entryNote: {
        fontSize: 13,
        color: '#374151',
        fontStyle: 'italic',
        marginTop: 6,
    },
});
