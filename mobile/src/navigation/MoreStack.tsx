import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { AccountPrivacyScreen, AnalyticsDrilldownScreen, AnalyticsScreen, AnswerWritingCanvasScreen, CommunityChatScreen, CommunityScreen, ConceptCoachScreen, ConceptMapBuilderScreen, CurrentAffairsScreen, DailyBriefingScreen, FormulaSprintScreen, GuidanceDoubtsScreen, LibraryScreen, OfflineManagerScreen, PdfAnnotationEditorScreen, PracticeLabScreen, RecallStudioScreen, SharedStudyDashboardScreen, StudyToolsScreen, WeeklyReviewScreen, WellbeingProtocolScreen } from '@/screens';
import { useTranslation } from '@/localization';

import { NotesStack } from './NotesStack';
import type { MoreStackParamList } from './types';
import { MoreMenuScreen } from './MoreMenuScreen';

const Stack = createNativeStackNavigator<MoreStackParamList>();

/** Secondary surfaces live in one stack so the bottom navigation stays readable on phones. */
export function MoreStack(): React.JSX.Element {
    const t = useTranslation();
    return (
        <Stack.Navigator>
            <Stack.Screen name="More" component={MoreMenuScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Notes" component={NotesStack} options={{ headerShown: false }} />
            <Stack.Screen name="Updates" component={CurrentAffairsScreen} />
            <Stack.Screen name="Tools" component={StudyToolsScreen} />
            <Stack.Screen name="Library" component={LibraryScreen} />
            <Stack.Screen name="Community" component={CommunityScreen} />
            <Stack.Screen name="Analytics" component={AnalyticsScreen} />
            <Stack.Screen name="WeeklyReview" component={WeeklyReviewScreen} options={{ title: 'Weekly review' }} />
            <Stack.Screen name="ConceptCoach" component={ConceptCoachScreen} options={{ title: t('conceptCoach.title') }} />
            <Stack.Screen name="DailyBriefing" component={DailyBriefingScreen} options={{ title: t('more.dailyBriefingTitle') }} />
            <Stack.Screen name="OfflineManager" component={OfflineManagerScreen} options={{ title: t('more.offlineTitle') }} />
            <Stack.Screen name="RecallStudio" component={RecallStudioScreen} options={{ title: t('more.recallStudioTitle') }} />
            <Stack.Screen name="FormulaSprint" component={FormulaSprintScreen} options={{ title: t('more.formulaSprintTitle') }} />
            <Stack.Screen name="ConceptMapBuilder" component={ConceptMapBuilderScreen} options={{ title: t('more.conceptMapTitle') }} />
            <Stack.Screen name="PracticeLab" component={PracticeLabScreen} options={{ title: t('more.practiceLabTitle') }} />
            <Stack.Screen name="AnswerWritingCanvas" component={AnswerWritingCanvasScreen} options={{ title: t('more.answerWritingTitle') }} />
            <Stack.Screen name="WellbeingProtocol" component={WellbeingProtocolScreen} options={{ title: t('more.wellbeingTitle') }} />
            <Stack.Screen name="GuidanceDoubts" component={GuidanceDoubtsScreen} options={{ title: t('more.guidanceTitle') }} />
            <Stack.Screen name="AnalyticsDrilldown" component={AnalyticsDrilldownScreen} options={{ title: t('analytics.scoreTrajectory') }} />
            <Stack.Screen name="CommunityChat" component={CommunityChatScreen} options={{ title: t('community.buddyChat') }} />
            <Stack.Screen name="SharedStudyDashboard" component={SharedStudyDashboardScreen} options={{ title: t('community.sharedDashboard') }} />
            <Stack.Screen name="PdfAnnotationEditor" component={PdfAnnotationEditorScreen} options={{ title: t('library.pdfAnnotation') }} />
            <Stack.Screen name="AccountPrivacy" component={AccountPrivacyScreen} options={{ title: t('account.title') }} />
        </Stack.Navigator>
    );
}
