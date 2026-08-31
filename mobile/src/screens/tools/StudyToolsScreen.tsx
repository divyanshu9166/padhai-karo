import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import { scheduleExamChecklistReminder, scheduleRevisionReminder } from '@/notifications/reminders';
import {
    createDoubt,
    exportDoubtsCsv,
    createFormula,
    createConceptMap,
    getConceptMaps,
    createRecoveryPlan,
    connectCoaching,
    syncCoaching,
    getCounselling,
    getDoubts,
    getExamChecklist,
    getFormulas,
    getMilestones,
    getRevisionCards,
    getStrategies,
    getWellbeingInsights,
    getAmbientModes,
    createRecallDrillAttempt,
    logAnxietyProtocol,
    predictRoleFit,
    reviewRevisionCard,
    savePacing,
    submitAnswerWriting,
    simulateStrategy,
    updateExamChecklist,
    type ChecklistItem,
    type ConceptMap,
    type DoubtItem,
    type FormulaItem,
    type Milestone,
    type RevisionCard,
    type StrategyItem,
    type WellbeingInsights,
    type AmbientMode,
} from '@/api/upscProduct';

type ToolSection = 'recall' | 'practice' | 'wellbeing' | 'guidance';

export function StudyToolsScreen(): React.JSX.Element {
    const t = useTranslation();
    const [activeSection, setActiveSection] = useState<ToolSection>('recall');
    const [cards, setCards] = useState<RevisionCard[]>([]);
    const [formulas, setFormulas] = useState<FormulaItem[]>([]);
    const [conceptMaps, setConceptMaps] = useState<ConceptMap[]>([]);
    const [milestones, setMilestones] = useState<Milestone[]>([]);
    const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
    const [strategies, setStrategies] = useState<StrategyItem[]>([]);
    const [doubts, setDoubts] = useState<DoubtItem[]>([]);
    const [wellbeing, setWellbeing] = useState<WellbeingInsights | null>(null);
    const [prompt, setPrompt] = useState('');
    const [answer, setAnswer] = useState('');
    const [formulaTitle, setFormulaTitle] = useState('');
    const [formulaExpression, setFormulaExpression] = useState('');
    const [mapTitle, setMapTitle] = useState('');
    const [mapNodes, setMapNodes] = useState('');
    const [mapEdges, setMapEdges] = useState('');
    const [paceQuestions, setPaceQuestions] = useState('10');
    const [paceTarget, setPaceTarget] = useState('600');
    const [paceActual, setPaceActual] = useState('600');
    const [paceCorrect, setPaceCorrect] = useState('8');
    const [paceSkipped, setPaceSkipped] = useState('0');
    const [doubtTitle, setDoubtTitle] = useState('');
    const [doubtQuestion, setDoubtQuestion] = useState('');
    const [doubtTag, setDoubtTag] = useState('needs-review');
    const [doubtResourceUrl, setDoubtResourceUrl] = useState('');
    const [counselling, setCounselling] = useState<string | null>(null);
    const [ambientModes, setAmbientModes] = useState<AmbientMode[]>([]);
    const [sound, setSound] = useState<Audio.Sound | null>(null);
    const [cardRevealed, setCardRevealed] = useState(false);
    const [sprintIndex, setSprintIndex] = useState(0);
    const [sprintSeconds, setSprintSeconds] = useState(300);
    const [sprintRunning, setSprintRunning] = useState(false);
    const [sprintRevealed, setSprintRevealed] = useState(false);
    const [sprintCorrect, setSprintCorrect] = useState(0);
    const [sprintStartedAt, setSprintStartedAt] = useState<number | null>(null);
    const [paceRunning, setPaceRunning] = useState(false);
    const [paceRemaining, setPaceRemaining] = useState(0);
    const [paceAnswered, setPaceAnswered] = useState(0);
    const [paceLiveCorrect, setPaceLiveCorrect] = useState(0);
    const [paceLiveSkipped, setPaceLiveSkipped] = useState(0);
    const [strategyQuestions, setStrategyQuestions] = useState('100');
    const [strategyTime, setStrategyTime] = useState('3600');
    const [strategyAttempted, setStrategyAttempted] = useState('75');
    const [strategyResult, setStrategyResult] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const reminderScheduled = useRef(false);
    const checklistRemindersScheduled = useRef(false);
    const formulaFinishInFlight = useRef(false);
    const pacingFinishInFlight = useRef(false);
    const visible = (section: ToolSection): object => activeSection === section ? {} : styles.hidden;

    const load = useCallback(async (section: ToolSection = activeSection): Promise<void> => {
        if (section === 'recall') {
            const [revision, formulaResult, conceptMapResult] = await Promise.all([
                getRevisionCards(true).catch(() => ({ cards: [], dueCount: 0 })),
                getFormulas().catch(() => ({ items: [] })),
                getConceptMaps().catch(() => ({ maps: [] })),
            ]);
            setCards(revision.cards); setFormulas(formulaResult.items); setConceptMaps(conceptMapResult.maps);
        } else if (section === 'wellbeing') {
            const [checklistResult, wellbeingResult] = await Promise.all([
                getExamChecklist().catch(() => ({ items: [] })),
                getWellbeingInsights().catch(() => null),
            ]);
            setChecklist(checklistResult.items); setWellbeing(wellbeingResult);
            if (!checklistRemindersScheduled.current) {
                checklistRemindersScheduled.current = true;
                void Promise.all(checklistResult.items.filter((item) => item.dueAt && !item.completed).map((item) => scheduleExamChecklistReminder(new Date(item.dueAt as string), item.label))).catch(() => undefined);
            }
        } else if (section === 'guidance') {
            const [milestoneResult, strategyResult, doubtResult, ambient] = await Promise.all([
                getMilestones().catch(() => ({ milestones: [] })),
                getStrategies().catch(() => ({ strategies: [] })),
                getDoubts().catch(() => ({ doubts: [] })),
                getAmbientModes().catch(() => ({ modes: [] })),
            ]);
            setMilestones(milestoneResult.milestones); setStrategies(strategyResult.strategies); setDoubts(doubtResult.doubts); setAmbientModes(ambient.modes);
        }
    }, [activeSection]);

    useEffect(() => { void load(activeSection); }, [activeSection, load]);
    useEffect(() => () => { if (sound) void sound.unloadAsync().catch(() => undefined); }, [sound]);
    useEffect(() => {
        if (!sprintRunning) return;
        const timer = setInterval(() => setSprintSeconds((value) => Math.max(0, value - 1)), 1000);
        return () => clearInterval(timer);
    }, [sprintRunning]);
    useEffect(() => {
        if (sprintRunning && sprintSeconds === 0) void finishFormulaSprint();
    }, [sprintRunning, sprintSeconds]);
    useEffect(() => {
        if (!paceRunning) return;
        const timer = setInterval(() => setPaceRemaining((value) => Math.max(0, value - 1)), 1000);
        return () => clearInterval(timer);
    }, [paceRunning]);
    useEffect(() => {
        if (cards.length === 0 || reminderScheduled.current) return;
        reminderScheduled.current = true;
        const reminderAt = new Date();
        reminderAt.setHours(9, 0, 0, 0);
        if (reminderAt.getTime() <= Date.now()) reminderAt.setDate(reminderAt.getDate() + 1);
        void scheduleRevisionReminder(reminderAt, cards.length).catch(() => undefined);
    }, [cards.length]);

    const run = async (action: () => Promise<unknown>, success: string): Promise<void> => {
        setBusy(true); setMessage(null);
        try { await action(); setMessage(success); await load(activeSection); }
        catch (error) { setMessage(error instanceof ApiError ? error.message : 'Could not save this action.'); }
        finally { setBusy(false); }
    };

    const currentCard = cards[0];
    const sprintItems = formulas.slice(0, 10);
    const currentFormula = sprintItems[sprintIndex];
    const startFormulaSprint = (): void => {
        if (sprintItems.length === 0) { setMessage('Add at least one formula before starting a sprint.'); return; }
        formulaFinishInFlight.current = false;
        setSprintIndex(0); setSprintSeconds(300); setSprintCorrect(0); setSprintRevealed(false); setSprintStartedAt(Date.now()); setSprintRunning(true); setMessage(`${t('tools.recall')}: Formula sprint started. Recall before revealing each expression.`);
    };
    const finishFormulaSprint = async (correct = sprintCorrect): Promise<void> => {
        if (formulaFinishInFlight.current) return;
        formulaFinishInFlight.current = true;
        const durationSec = Math.max(1, Math.round((Date.now() - (sprintStartedAt ?? Date.now())) / 1000));
        setSprintRunning(false);
        try { await createRecallDrillAttempt({ sourceType: 'FORMULA', itemCount: sprintItems.length, durationSec, correct, revealed: Math.min(sprintItems.length, sprintIndex + (sprintRevealed ? 1 : 0)) }); setMessage(`Formula sprint complete: ${correct}/${sprintItems.length} correct.`); } catch (error) { setMessage(error instanceof ApiError ? error.message : 'Sprint result could not be saved.'); }
    };
    const answerFormula = (correct: boolean): void => {
        const nextCorrect = sprintCorrect + (correct ? 1 : 0);
        if (sprintIndex >= sprintItems.length - 1) { void finishFormulaSprint(nextCorrect); return; }
        setSprintCorrect(nextCorrect); setSprintIndex((value) => value + 1); setSprintRevealed(false);
    };
    const startPacingRound = (): void => {
        const count = Math.max(1, Math.floor(Number(paceQuestions) || 0));
        const target = Math.max(1, Math.floor(Number(paceTarget) || 0));
        pacingFinishInFlight.current = false;
        setPaceAnswered(0); setPaceLiveCorrect(0); setPaceLiveSkipped(0); setPaceRemaining(target); setPaceRunning(true); setMessage(`Live pacing round started: ${count} questions in ${target} seconds.`);
    };
    const finishPacingRound = async (correct = paceLiveCorrect, skipped = paceLiveSkipped): Promise<void> => {
        if (pacingFinishInFlight.current) return;
        pacingFinishInFlight.current = true;
        const count = Math.max(1, Math.floor(Number(paceQuestions) || 0));
        const target = Math.max(1, Math.floor(Number(paceTarget) || 0));
        const actual = Math.max(1, target - paceRemaining);
        setPaceRunning(false);
        await run(() => savePacing({ questionCount: count, targetSeconds: target, actualSeconds: actual, correct, skipped }), 'Live pacing result saved.');
    };
    useEffect(() => {
        if (paceRunning && paceRemaining === 0) void finishPacingRound();
    }, [paceRunning, paceRemaining]);
    const recordPacingOutcome = (kind: 'CORRECT' | 'SKIP'): void => {
        const nextAnswered = paceAnswered + 1;
        const nextCorrect = paceLiveCorrect + (kind === 'CORRECT' ? 1 : 0);
        const nextSkipped = paceLiveSkipped + (kind === 'SKIP' ? 1 : 0);
        setPaceAnswered(nextAnswered); setPaceLiveCorrect(nextCorrect); setPaceLiveSkipped(nextSkipped);
        if (nextAnswered >= Math.max(1, Math.floor(Number(paceQuestions) || 0))) void finishPacingRound(nextCorrect, nextSkipped);
    };
    const runStrategySimulation = async (): Promise<void> => {
        setBusy(true); setStrategyResult(null);
        try {
            const result = await simulateStrategy({ questionCount: Number(strategyQuestions), totalTimeSec: Number(strategyTime), targetAttempted: Number(strategyAttempted) });
            setStrategyResult(`${result.simulation.feasibility} · ${result.simulation.secondsPerQuestion}s/question · ${result.simulation.bufferSec}s protected buffer · ${result.simulation.advice.join(' ')}`);
        } catch (error) { setMessage(error instanceof ApiError ? error.message : 'Could not simulate the strategy.'); }
        finally { setBusy(false); }
    };
    const playAmbient = async (mode: AmbientMode): Promise<void> => {
        if (sound) { await sound.unloadAsync().catch(() => undefined); setSound(null); }
        if (!mode.url) { setMessage('Set the ' + mode.id + ' audio URL on the backend to enable playback.'); return; }
        try {
            const created = await Audio.Sound.createAsync({ uri: mode.url }, { shouldPlay: true, isLooping: mode.loop });
            setSound(created.sound);
            setMessage(mode.label + ' is playing.');
        } catch { setMessage('Ambient audio could not be loaded. Check the configured URL.'); }
    };

    return <Screen title={t('tools.title')}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('tools.intro')}</Text>
        <View style={styles.sectionBar}>{([['recall', 'tools.recall'], ['practice', 'tools.practice'], ['wellbeing', 'tools.wellbeing'], ['guidance', 'tools.guidance']] as const).map(([key, labelKey]) => <Pressable key={key} style={[styles.sectionChip, activeSection === key && styles.sectionChipActive]} onPress={() => setActiveSection(key)}><Text style={[styles.sectionChipText, activeSection === key && styles.sectionChipTextActive]}>{t(labelKey)}</Text></Pressable>)}</View>
        <View style={[styles.card, visible('recall')] }>
            <Text style={styles.heading}>Active recall and spaced revision</Text>
            {currentCard ? <><Text style={styles.muted}>{currentCard.title}</Text><Text style={styles.prompt}>{currentCard.prompt}</Text>{cardRevealed ? <Text style={styles.answer}>{currentCard.answer}</Text> : <Pressable style={styles.secondary} onPress={() => setCardRevealed(true)}><Text style={styles.secondaryText}>Reveal answer</Text></Pressable>}{cardRevealed ? <View style={styles.ratingRow}>{([1, 2, 3, 4] as const).map((rating) => <Pressable key={rating} style={styles.rating} onPress={() => { setCardRevealed(false); void run(() => reviewRevisionCard(currentCard.id, rating), 'Next review scheduled.'); }}><Text style={styles.ratingText}>{['Again', 'Hard', 'Good', 'Easy'][rating - 1]}</Text></Pressable>)}</View> : null}</> : <Text style={styles.muted}>No cards due. Notes and capsules will add cards automatically.</Text>}
        </View>

        <View style={[styles.card, visible('recall')] }><Text style={styles.heading}>Formula vault + active Formula Sprint</Text><TextInput style={styles.input} placeholder="Formula title" value={formulaTitle} onChangeText={setFormulaTitle} /><TextInput style={styles.input} placeholder="Expression or rule" value={formulaExpression} onChangeText={setFormulaExpression} /><Pressable style={styles.button} disabled={busy} onPress={() => void run(() => createFormula({ title: formulaTitle, expression: formulaExpression }), 'Formula saved.') }><Text style={styles.buttonText}>Save formula</Text></Pressable>{!sprintRunning ? <Pressable style={styles.secondary} onPress={startFormulaSprint}><Text style={styles.secondaryText}>Start 5-minute Formula Sprint</Text></Pressable> : currentFormula ? <View style={styles.sprint}><Text style={styles.muted}>Sprint {sprintIndex + 1}/{sprintItems.length} · {Math.floor(sprintSeconds / 60)}:{String(sprintSeconds % 60).padStart(2, '0')}</Text><Text style={styles.prompt}>{currentFormula.title}</Text>{sprintRevealed ? <Text style={styles.answer}>{currentFormula.expression}</Text> : <Pressable style={styles.secondary} onPress={() => setSprintRevealed(true)}><Text style={styles.secondaryText}>Reveal expression</Text></Pressable>}{sprintRevealed ? <View style={styles.buttonRow}><Pressable style={styles.secondary} onPress={() => answerFormula(true)}><Text style={styles.secondaryText}>Got it</Text></Pressable><Pressable style={styles.secondary} onPress={() => answerFormula(false)}><Text style={styles.secondaryText}>Needs review</Text></Pressable></View> : null}</View> : null}{formulas.slice(0, 4).map((formula) => <View key={formula.id} style={styles.listRow}><Text style={styles.bold}>{formula.title}</Text><Text style={styles.muted}>{formula.expression}</Text></View>)}</View>

        <View style={[styles.card, visible('recall')] }><Text style={styles.heading}>Concept-map builder</Text><Text style={styles.muted}>Build a relationship graph from concepts and labelled edges; invalid edges are ignored.</Text><TextInput style={styles.input} placeholder="Map title" value={mapTitle} onChangeText={setMapTitle} /><TextInput style={styles.input} placeholder="Nodes, comma separated" value={mapNodes} onChangeText={setMapNodes} /><TextInput style={styles.input} placeholder="Edges, e.g. polity->constitution" value={mapEdges} onChangeText={setMapEdges} /><Pressable style={styles.button} disabled={busy} onPress={() => void run(() => createConceptMap({ title: mapTitle, nodes: mapNodes.split(',').map((value) => ({ id: value.trim(), label: value.trim() })).filter((value) => value.id), edges: mapEdges.split(',').map((value) => { const [from, to] = value.split('->').map((part) => part.trim()); return { from, to }; }).filter((value) => value.from && value.to) }), 'Concept map saved.') }><Text style={styles.buttonText}>Save concept map</Text></Pressable>{conceptMaps.slice(0, 3).map((map) => <View key={map.id} style={styles.listRow}><Text style={styles.bold}>{map.title}</Text><Text style={styles.muted}>{Array.isArray(map.nodes) ? map.nodes.length : 0} concepts · {Array.isArray(map.edges) ? map.edges.length : 0} relationships</Text></View>)}</View>

        <View style={[styles.card, visible('practice')] }><Text style={styles.heading}>Pacing trainer</Text><Text style={styles.muted}>A live round trains read → decide → skip reflexes. The timer records speed, accuracy and skipped questions.</Text><View style={styles.twoCol}><TextInput style={[styles.input, styles.half]} keyboardType="numeric" placeholder="Questions" value={paceQuestions} onChangeText={setPaceQuestions} /><TextInput style={[styles.input, styles.half]} keyboardType="numeric" placeholder="Target total sec" value={paceTarget} onChangeText={setPaceTarget} /></View>{paceRunning ? <View style={styles.sprint}><Text style={paceRemaining <= 10 ? styles.warning : styles.muted}>Time left {Math.floor(paceRemaining / 60)}:{String(paceRemaining % 60).padStart(2, '0')} · Question {Math.min(paceAnswered + 1, Number(paceQuestions) || 1)}/{paceQuestions}</Text><View style={styles.buttonRow}><Pressable style={styles.secondary} onPress={() => recordPacingOutcome('CORRECT')}><Text style={styles.secondaryText}>Correct / next</Text></Pressable><Pressable style={styles.secondary} onPress={() => recordPacingOutcome('SKIP')}><Text style={styles.secondaryText}>Skip / next</Text></Pressable></View><Pressable style={styles.secondary} onPress={() => void finishPacingRound()}><Text style={styles.secondaryText}>Finish round</Text></Pressable></View> : <Pressable style={styles.button} disabled={busy} onPress={startPacingRound}><Text style={styles.buttonText}>Start live pacing round</Text></Pressable>}<Text style={styles.muted}>For manual import: log a completed set below.</Text><View style={styles.twoCol}><TextInput style={[styles.input, styles.half]} keyboardType="numeric" placeholder="Actual sec" value={paceActual} onChangeText={setPaceActual} /><TextInput style={[styles.input, styles.half]} keyboardType="numeric" placeholder="Correct" value={paceCorrect} onChangeText={setPaceCorrect} /></View><TextInput style={styles.input} keyboardType="numeric" placeholder="Skipped" value={paceSkipped} onChangeText={setPaceSkipped} /><Pressable style={styles.secondary} disabled={busy} onPress={() => void run(() => savePacing({ questionCount: Number(paceQuestions), targetSeconds: Number(paceTarget), actualSeconds: Number(paceActual), correct: Number(paceCorrect), skipped: Number(paceSkipped) }), 'Pacing attempt logged.') }><Text style={styles.secondaryText}>Log completed set</Text></Pressable></View>

        <View style={[styles.card, visible('practice')] }><Text style={styles.heading}>UPSC answer writing</Text><TextInput style={styles.input} placeholder="Question / prompt" value={prompt} onChangeText={setPrompt} multiline /><TextInput style={[styles.input, styles.multiline]} placeholder="Write your answer" value={answer} onChangeText={setAnswer} multiline /><Pressable style={styles.button} disabled={busy} onPress={() => void run(async () => { await submitAnswerWriting({ prompt, answerText: answer }); setPrompt(''); setAnswer(''); }, 'Answer saved for review.') }><Text style={styles.buttonText}>Submit answer</Text></Pressable></View>

        <View style={[styles.card, visible('wellbeing')] }><Text style={styles.heading}>Wellbeing and anxiety protocol</Text>{wellbeing ? <Text style={wellbeing.risk === 'HIGH' ? styles.warning : styles.muted}>Risk: {wellbeing.risk}. Average stress {wellbeing.signals.averageStress.toFixed(1)}, energy {wellbeing.signals.averageEnergy.toFixed(1)}.</Text> : <ActivityIndicator color="#2563eb" />}<View style={styles.buttonRow}><Pressable style={styles.secondary} onPress={() => void run(() => logAnxietyProtocol('BOX_BREATHING', 120), 'Two-minute box breathing logged.') }><Text style={styles.secondaryText}>Box breathing</Text></Pressable><Pressable style={styles.secondary} onPress={() => void run(() => logAnxietyProtocol('GROUNDING_5_4_3_2_1', 180), 'Grounding protocol logged.') }><Text style={styles.secondaryText}>Grounding</Text></Pressable></View><Pressable style={styles.button} onPress={() => void run(() => createRecoveryPlan('User requested a lighter three-day reset'), 'Three-day recovery plan created.') }><Text style={styles.buttonText}>Create 3-day recovery plan</Text></Pressable></View>

        <View style={[styles.card, visible('wellbeing')] }><Text style={styles.heading}>Exam-day checklist</Text>{checklist.map((item) => <Pressable key={item.id} style={styles.checkRow} onPress={() => void run(async () => { await updateExamChecklist(item.id, !item.completed); }, 'Checklist updated.')}><Text style={item.completed ? styles.done : styles.checkbox}>{item.completed ? '✓' : '○'}</Text><View style={styles.checkCopy}><Text style={item.completed ? styles.doneText : styles.body}>{item.label}</Text>{item.dueAt ? <Text style={styles.muted}>Prepare by {new Date(item.dueAt).toLocaleDateString()}</Text> : null}</View></Pressable>)}</View>

        <View style={[styles.card, visible('guidance')] }><Text style={styles.heading}>Milestones</Text>{milestones.map((milestone) => <View key={milestone.id} style={styles.listRow}><Text style={styles.bold}>{milestone.label}</Text><Text style={styles.muted}>{Math.round(milestone.currentValue)} / {Math.round(milestone.targetValue)} {milestone.achievedAt ? ' · achieved' : ''}</Text></View>)}</View>

        <View style={[styles.card, visible('guidance')] }><Text style={styles.heading}>Doubt journal, tagging and resources</Text><TextInput style={styles.input} placeholder="Doubt title" value={doubtTitle} onChangeText={setDoubtTitle} /><TextInput style={[styles.input, styles.multiline]} placeholder="Question or confusing point" value={doubtQuestion} onChangeText={setDoubtQuestion} multiline /><TextInput style={styles.input} placeholder="Tags, e.g. polity, concept-gap" value={doubtTag} onChangeText={setDoubtTag} /><TextInput style={styles.input} placeholder="YouTube/article URL (optional)" value={doubtResourceUrl} onChangeText={setDoubtResourceUrl} autoCapitalize="none" keyboardType="url" /><Pressable style={styles.button} onPress={() => void run(async () => { await createDoubt({ title: doubtTitle, question: doubtQuestion, tags: doubtTag.split(',').map((item) => item.trim()).filter(Boolean), resourceUrls: doubtResourceUrl.trim() ? [doubtResourceUrl.trim()] : [] }); setDoubtTitle(''); setDoubtQuestion(''); }, 'Doubt saved.') }><Text style={styles.buttonText}>Save doubt</Text></Pressable><Pressable style={styles.secondary} onPress={() => void run(async () => { const csv = await exportDoubtsCsv(); await Share.share({ title: 'Padhai Karo doubts', message: csv }); }, 'CSV export ready.') }><Text style={styles.secondaryText}>Export doubts as CSV</Text></Pressable>{doubts.slice(0, 3).map((doubt) => <View key={doubt.id} style={styles.listRow}><Text style={styles.bold}>{doubt.title}</Text><Text style={styles.muted}>{doubt.status} · {doubt.tags.join(', ')}</Text>{doubt.resourceUrls.map((url) => <Text key={url} style={styles.link} onPress={() => void Linking.openURL(url)}>Open linked resource</Text>)}</View>)}</View>

        <View style={[styles.card, visible('guidance')] }><Text style={styles.heading}>Topper strategies</Text>{strategies.slice(0, 3).map((strategy) => <View key={strategy.id} style={styles.listRow}><Text style={styles.bold}>{strategy.title}</Text><Text style={styles.muted}>{strategy.body}</Text></View>)}</View>

        <View style={[styles.card, visible('practice')] }><Text style={styles.heading}>Attempt strategy simulator</Text><Text style={styles.muted}>Compare an attempted-first plan with review time before a mock.</Text><View style={styles.twoCol}><TextInput style={[styles.input, styles.half]} keyboardType="numeric" value={strategyQuestions} onChangeText={setStrategyQuestions} placeholder="Questions" /><TextInput style={[styles.input, styles.half]} keyboardType="numeric" value={strategyTime} onChangeText={setStrategyTime} placeholder="Total seconds" /></View><TextInput style={styles.input} keyboardType="numeric" value={strategyAttempted} onChangeText={setStrategyAttempted} placeholder="Target attempted" /><Pressable style={styles.secondary} disabled={busy} onPress={() => void runStrategySimulation()}><Text style={styles.secondaryText}>Simulate strategy</Text></Pressable>{strategyResult ? <Text style={styles.body}>{strategyResult}</Text> : null}</View>

        <View style={[styles.card, visible('guidance')] }><Text style={styles.heading}>Ambient focus</Text><Text style={styles.muted}>Play a configured looping sound while studying.</Text><View style={styles.buttonRow}>{ambientModes.map((mode) => <Pressable key={mode.id} style={styles.secondary} onPress={() => void playAmbient(mode)}><Text style={styles.secondaryText}>{mode.label}</Text></Pressable>)}</View></View>

        <View style={[styles.card, visible('guidance')] }><Text style={styles.heading}>Role and exam counselling</Text><Pressable style={styles.secondary} onPress={() => void run(async () => { const result = await getCounselling(); const prediction = await predictRoleFit({ interests: ['analysis'] }); setCounselling((prediction.predictions[0] as { name?: string })?.name ?? result.roles[0]?.name ?? 'Explore roles from the latest official notice.'); }, 'Counselling refreshed.') }><Text style={styles.secondaryText}>Suggest a role fit</Text></Pressable>{counselling ? <Text style={styles.body}>{counselling}</Text> : null}</View>

        <View style={[styles.card, visible('guidance')] }><Text style={styles.heading}>Coaching integration</Text><Text style={styles.muted}>Connect a coaching provider, then sync its resource metadata into your searchable library.</Text><Pressable style={styles.secondary} onPress={() => void run(() => connectCoaching('MANUAL_PROVIDER'), 'Coaching connection saved.')}><Text style={styles.secondaryText}>Connect coaching provider</Text></Pressable><Pressable style={styles.secondary} onPress={() => void run(() => syncCoaching('MANUAL_PROVIDER'), 'Coaching resources synced.')}><Text style={styles.secondaryText}>Sync coaching resources</Text></Pressable></View>

        {message ? <Text style={styles.message}>{message}</Text> : null}
    </ScrollView></Screen>;
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 32 },
    intro: { color: '#6b7280', lineHeight: 20, marginBottom: 8 },
    sectionBar: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
    sectionChip: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, marginRight: 7, marginBottom: 7, backgroundColor: '#fff' },
    sectionChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    sectionChipText: { color: '#334155', fontWeight: '700' },
    sectionChipTextActive: { color: '#fff' },
    hidden: { display: 'none' },
    card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 12, backgroundColor: '#fff' },
    heading: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 8 },
    prompt: { color: '#111827', fontWeight: '700', lineHeight: 21, marginTop: 8 },
    answer: { color: '#374151', lineHeight: 20, marginTop: 8 },
    muted: { color: '#6b7280', lineHeight: 19 },
    body: { color: '#374151', lineHeight: 20, marginTop: 8 },
    bold: { color: '#111827', fontWeight: '700' },
    warning: { color: '#b45309', lineHeight: 19 },
    input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, marginTop: 8, color: '#111827' },
    twoCol: { flexDirection: 'row', gap: 8 },
    half: { flex: 1 },
    multiline: { minHeight: 72, textAlignVertical: 'top' },
    button: { backgroundColor: '#2563eb', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 10 },
    buttonText: { color: '#fff', fontWeight: '700' },
    secondary: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, padding: 10, alignItems: 'center', marginRight: 8, marginTop: 8 },
    secondaryText: { color: '#2563eb', fontWeight: '700' },
    buttonRow: { flexDirection: 'row' },
    ratingRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
    rating: { backgroundColor: '#eff6ff', borderRadius: 7, paddingVertical: 8, paddingHorizontal: 10, marginRight: 6 },
    ratingText: { color: '#1d4ed8', fontWeight: '700' },
    sprint: { borderTopWidth: 1, borderTopColor: '#dbeafe', marginTop: 10, paddingTop: 10 },
    listRow: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 9, marginTop: 9 },
    checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    checkCopy: { flex: 1 },
    checkbox: { fontSize: 23, color: '#2563eb', marginRight: 8 },
    done: { fontSize: 20, color: '#15803d', marginRight: 8 },
    doneText: { color: '#15803d', textDecorationLine: 'line-through' },
    message: { color: '#15803d', fontWeight: '700', marginBottom: 12 },
    link: { color: '#2563eb', marginTop: 5 },
});
