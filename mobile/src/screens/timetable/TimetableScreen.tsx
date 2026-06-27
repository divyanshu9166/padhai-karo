/**
 * Timetable screen (task 21.3; Req 3.1, 3.4, 3.5, 3.7, 15.4, 16.1, 16.6).
 *
 * Renders the generated weekly timetable (study blocks + Buffer_Slots), supports generating a
 * week, editing/deleting blocks (surfacing a 409 overlap conflict, Req 3.5), marking a block
 * missed to trigger the adaptive rebalancer (Req 15.2/15.3), marking calendar events
 * (Req 16.1), and the unused-buffer policy (Req 15.4). All scheduling is server-side; the
 * client renders and submits intents.
 *
 * Reconstructed during scaffold recovery; composes the surviving timetable `api`, `BlockRow`,
 * `EditBlockModal`, `CalendarEventModal`, and `dateUtils` modules.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import {
    ApiError,
    createCalendarEvent,
    deleteBlock,
    editBlock,
    generateTimetable,
    getHolidaySprintOffer,
    getTimetable,
    markBlockMissed,
    setBufferPolicy,
    type BufferPolicy,
    type CalendarEventType,
    type CreateCalendarEventInput,
    type EditBlockInput,
    type HolidaySprintPlan,
    type StudyBlock,
} from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';

import { BlockRow } from './BlockRow';
import { BufferPolicyBar } from './BufferPolicyBar';
import { CalendarEventModal } from './CalendarEventModal';
import { currentWeekStartIso, dayHeading, dayKey, formatWeekRange, shiftWeekIso } from './dateUtils';
import { EditBlockModal } from './EditBlockModal';
import { HolidaySprintBanner } from './HolidaySprintBanner';

export function TimetableScreen(): React.JSX.Element {
    const t = useTranslation();

    const [weekStart, setWeekStart] = useState<string>(() => currentWeekStartIso());
    const [blocks, setBlocks] = useState<StudyBlock[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [editing, setEditing] = useState<StudyBlock | null>(null);
    const [editError, setEditError] = useState<string | null>(null);
    const [editSubmitting, setEditSubmitting] = useState(false);

    const [eventModalOpen, setEventModalOpen] = useState(false);
    const [eventError, setEventError] = useState<string | null>(null);
    const [eventSubmitting, setEventSubmitting] = useState(false);

    const [bufferPolicy, setBufferPolicyState] = useState<BufferPolicy | null>(null);
    const [sprintPlan, setSprintPlan] = useState<HolidaySprintPlan | null>(null);

    const load = useCallback(
        async (week: string): Promise<void> => {
            setLoading(true);
            setError(null);
            try {
                const { studyBlocks } = await getTimetable(week);
                setBlocks(studyBlocks);
            } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Could not load the timetable.');
                setBlocks([]);
            } finally {
                setLoading(false);
            }
        },
        [],
    );

    useEffect(() => {
        void load(weekStart);
    }, [load, weekStart]);

    // Surface the upcoming holiday-sprint offer when one is available (Req 16.6).
    useEffect(() => {
        let active = true;
        void (async (): Promise<void> => {
            try {
                const { offer } = await getHolidaySprintOffer();
                if (active) {
                    setSprintPlan(offer.available ? offer.plan : null);
                }
            } catch {
                if (active) {
                    setSprintPlan(null);
                }
            }
        })();
        return () => {
            active = false;
        };
    }, []);

    const onGenerate = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            const res = await generateTimetable(weekStart);
            setBlocks([...res.studyBlocks, ...res.bufferSlots]);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not generate the timetable.');
        } finally {
            setBusy(false);
        }
    };

    const onSubmitEdit = async (patch: EditBlockInput): Promise<void> => {
        if (!editing) {
            return;
        }
        setEditSubmitting(true);
        setEditError(null);
        try {
            const { studyBlock } = await editBlock(editing.id, patch);
            setBlocks((prev) => prev.map((b) => (b.id === studyBlock.id ? studyBlock : b)));
            setEditing(null);
        } catch (err) {
            // Surface a 409 overlap inline, leaving the original block unchanged (Req 3.5).
            if (err instanceof ApiError && err.code === 'TIMETABLE_OVERLAP') {
                setEditError(t('timetable.overlapError'));
            } else {
                setEditError(err instanceof ApiError ? err.message : 'Could not save the edit.');
            }
        } finally {
            setEditSubmitting(false);
        }
    };

    const onDelete = async (block: StudyBlock): Promise<void> => {
        setBusy(true);
        try {
            await deleteBlock(block.id);
            setBlocks((prev) => prev.filter((b) => b.id !== block.id));
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not delete the block.');
        } finally {
            setBusy(false);
        }
    };

    const onMarkMissed = async (block: StudyBlock): Promise<void> => {
        setBusy(true);
        try {
            await markBlockMissed(block.id);
            await load(weekStart);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not rebalance the block.');
        } finally {
            setBusy(false);
        }
    };

    const onCreateEvent = async (input: CreateCalendarEventInput): Promise<void> => {
        setEventSubmitting(true);
        setEventError(null);
        try {
            await createCalendarEvent(input);
            setEventModalOpen(false);
            // A newly marked holiday may make a sprint offer available (Req 16.6).
            try {
                const { offer } = await getHolidaySprintOffer();
                setSprintPlan(offer.available ? offer.plan : null);
            } catch {
                /* leave the existing offer state unchanged */
            }
        } catch (err) {
            setEventError(err instanceof ApiError ? err.message : 'Could not save the event.');
        } finally {
            setEventSubmitting(false);
        }
    };

    const onSelectBufferPolicy = async (policy: BufferPolicy): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            const { bufferPolicy: saved } = await setBufferPolicy(policy);
            setBufferPolicyState(saved);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : t('timetable.bufferPolicyError'));
        } finally {
            setBusy(false);
        }
    };

    const blockLabels = useMemo(
        () => ({
            bufferSlot: t('timetable.bufferSlot'),
            edit: t('common.edit'),
            delete: t('common.delete'),
            markMissed: t('timetable.markMissed'),
            outsidePeak: t('timetable.outsidePeak'),
            highEnergy: t('timetable.highEnergy'),
            lowEnergy: t('timetable.lowEnergy'),
            subject: t('timetable.subject'),
            noSubject: t('timetable.bufferSlot'),
        }),
        [t],
    );

    const eventTypeLabels = useMemo<Record<CalendarEventType, string>>(
        () => ({
            SCHOOL_EXAM: t('timetable.event.schoolExam'),
            HOLIDAY: t('timetable.event.holiday'),
            MOCK_TEST: t('timetable.event.mockTest'),
        }),
        [t],
    );

    // Group blocks by UTC day for day headings.
    const grouped = useMemo(() => {
        const map = new Map<string, StudyBlock[]>();
        for (const block of [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
            const key = dayKey(block.startTime);
            const list = map.get(key) ?? [];
            list.push(block);
            map.set(key, list);
        }
        return [...map.entries()];
    }, [blocks]);

    return (
        <Screen title={t('timetable.title')}>
            <View style={styles.weekBar}>
                <Pressable
                    style={styles.weekNav}
                    onPress={() => setWeekStart((w) => shiftWeekIso(w, -1))}
                >
                    <Text style={styles.weekNavText}>‹</Text>
                </Pressable>
                <Text style={styles.weekLabel}>{formatWeekRange(weekStart)}</Text>
                <Pressable
                    style={styles.weekNav}
                    onPress={() => setWeekStart((w) => shiftWeekIso(w, 1))}
                >
                    <Text style={styles.weekNavText}>›</Text>
                </Pressable>
            </View>

            <View style={styles.actionsBar}>
                <Pressable
                    style={[styles.primary, busy && styles.disabled]}
                    onPress={() => void onGenerate()}
                    disabled={busy}
                >
                    <Text style={styles.primaryText}>{t('timetable.generate')}</Text>
                </Pressable>
                <Pressable style={styles.secondary} onPress={() => setEventModalOpen(true)}>
                    <Text style={styles.secondaryText}>+ {t('timetable.addEvent')}</Text>
                </Pressable>
            </View>

            <HolidaySprintBanner
                plan={sprintPlan}
                labels={{
                    title: t('timetable.holidaySprint.title'),
                    summary: t('timetable.holidaySprint.summary'),
                    suggestedDaily: t('timetable.holidaySprint.suggestedDaily'),
                    hours: t('timetable.holidaySprint.hours'),
                }}
            />

            <BufferPolicyBar
                selected={bufferPolicy}
                busy={busy}
                onSelect={(policy) => void onSelectBufferPolicy(policy)}
                labels={{
                    title: t('timetable.bufferPolicy'),
                    catchUp: t('timetable.bufferPolicy.catchUp'),
                    extraRevision: t('timetable.bufferPolicy.extraRevision'),
                }}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#2563eb" />
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.scroll}>
                    {grouped.length === 0 ? (
                        <Text style={styles.muted}>{t('timetable.empty')}</Text>
                    ) : (
                        grouped.map(([key, dayBlocks]) => (
                            <View key={key}>
                                <Text style={styles.dayHeading}>
                                    {dayHeading(dayBlocks[0]?.startTime ?? key)}
                                </Text>
                                {dayBlocks.map((block) => (
                                    <BlockRow
                                        key={block.id}
                                        block={block}
                                        busy={busy}
                                        onEdit={setEditing}
                                        onDelete={(b) => void onDelete(b)}
                                        onMarkMissed={(b) => void onMarkMissed(b)}
                                        labels={blockLabels}
                                    />
                                ))}
                            </View>
                        ))
                    )}
                </ScrollView>
            )}

            <EditBlockModal
                block={editing}
                submitting={editSubmitting}
                errorMessage={editError}
                onSubmit={(patch) => void onSubmitEdit(patch)}
                onCancel={() => {
                    setEditing(null);
                    setEditError(null);
                }}
                labels={{
                    title: t('common.edit'),
                    startTime: t('timetable.startTime'),
                    durationMin: t('timetable.durationMin'),
                    subjectId: t('timetable.subjectId'),
                    save: t('common.save'),
                    cancel: t('common.cancel'),
                }}
            />

            <CalendarEventModal
                visible={eventModalOpen}
                submitting={eventSubmitting}
                errorMessage={eventError}
                onSubmit={(input) => void onCreateEvent(input)}
                onCancel={() => {
                    setEventModalOpen(false);
                    setEventError(null);
                }}
                labels={{
                    title: t('timetable.addEvent'),
                    type: t('timetable.event.type'),
                    startDate: t('timetable.event.startDate'),
                    endDate: t('timetable.event.endDate'),
                    save: t('common.save'),
                    cancel: t('common.cancel'),
                    dateFormatError: t('timetable.event.dateFormatError'),
                    typeLabels: eventTypeLabels,
                }}
            />
        </Screen>
    );
}

const styles = StyleSheet.create({
    weekBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    weekNav: { paddingHorizontal: 16, paddingVertical: 6 },
    weekNavText: { fontSize: 22, color: '#2563eb', fontWeight: '700' },
    weekLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
    actionsBar: { flexDirection: 'row', marginBottom: 12 },
    primary: {
        flex: 1,
        backgroundColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
        marginRight: 8,
    },
    primaryText: { color: '#ffffff', fontWeight: '700' },
    secondary: {
        borderWidth: 1,
        borderColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: 'center',
    },
    secondaryText: { color: '#2563eb', fontWeight: '700' },
    error: { color: '#dc2626', fontSize: 14, marginBottom: 12 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scroll: { paddingBottom: 32 },
    muted: { fontSize: 14, color: '#6b7280' },
    dayHeading: {
        fontSize: 13,
        fontWeight: '700',
        color: '#6b7280',
        marginTop: 12,
        marginBottom: 6,
        textTransform: 'uppercase',
    },
    disabled: { opacity: 0.6 },
});
