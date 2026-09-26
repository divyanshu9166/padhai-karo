/**
 * Practice navigator (task 21.1) — PYQ practice, Timed Paper mode, and Mistake journal,
 * grouped under the Practice tab. Fleshed out by task 21.6.
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AnswerWritingCanvasScreen, DailyQuizScreen, ExternalPaperReviewScreen, FormulaSprintScreen, MistakeJournalScreen, MockExamScreen, PracticeLabScreen, PyqScreen, TimedPaperScreen } from '@/screens';
import { useTranslation } from '@/localization';
import type { PracticeStackParamList } from './types';

const Stack = createNativeStackNavigator<PracticeStackParamList>();

export function PracticeStack(): React.JSX.Element {
    const t = useTranslation();
    return (
        <Stack.Navigator initialRouteName="Pyq">
            <Stack.Screen name="Pyq" component={PyqScreen} options={{ title: t('nav.pyqs'), headerShown: false }} />
            <Stack.Screen name="DailyQuiz" component={DailyQuizScreen} options={{ title: t('quiz.title') }} />
            <Stack.Screen name="Mock" component={MockExamScreen} options={{ title: t('practice.mockTitle') }} />
            <Stack.Screen
                name="TimedPaper"
                component={TimedPaperScreen}
                options={{ title: t('nav.timedPaper') }}
            />
            <Stack.Screen
                name="MistakeJournal"
                component={MistakeJournalScreen}
                options={{ title: t('mistakes.title') }}
            />
            <Stack.Screen
                name="ExternalPaperReview"
                component={ExternalPaperReviewScreen}
                options={{ title: t('nav.analyseTest') }}
            />
            <Stack.Screen name="AnswerWriting" component={AnswerWritingCanvasScreen} options={{ title: t('more.answerWritingTitle') }} />
            <Stack.Screen name="PracticeLab" component={PracticeLabScreen} options={{ title: t('nav.pacingTrainer') }} />
            <Stack.Screen name="FormulaSprint" component={FormulaSprintScreen} options={{ title: t('more.formulaSprintTitle') }} />
        </Stack.Navigator>
    );
}
