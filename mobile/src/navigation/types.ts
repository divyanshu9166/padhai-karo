/**
 * Navigation param lists + screen-prop helpers (task 21.1).
 *
 * Typed route maps for each navigator and the `*ScreenProps` helpers screens use to type their
 * `route`/`navigation` props. Screen tasks (21.2–21.9) extend these as they add params.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

/** Auth flow (unauthenticated users) — login/register (Req 1.1, 1.4). */
export type AuthStackParamList = {
    Login: undefined;
    Register: undefined;
    ForgotPassword: undefined;
};

/** Onboarding flow (authenticated, not-yet-onboarded users — Req 2.6). */
export type OnboardingStackParamList = {
    Onboarding: undefined;
};

/** Daily planning first; the advanced weekly calendar remains one tap inside Plan. */
export type PlanStackParamList = {
    Plan: undefined;
    Timetable: undefined;
};

/** Practice tab stack — PYQ practice, Timed Paper mode, Mistake journal (task 21.6). */
export type PracticeStackParamList = {
    Pyq: undefined;
    DailyQuiz: undefined;
    Mock: undefined;
    /** A paper id may be passed in to auto-start Timed Paper Mode. */
    TimedPaper: { paperId?: string } | undefined;
    MistakeJournal: undefined;
    ExternalPaperReview: undefined;
    AnswerWriting: undefined;
    PracticeLab: undefined;
    FormulaSprint: undefined;
};

/** Notes tab stack — AI notes summarizer + subscription/paywall (task 21.7). */
export type NotesStackParamList = {
    AiNotes: undefined;
    Paywall: undefined;
};

/** Main app bottom tabs (authenticated + onboarded users). */
export type MainTabParamList = {
    Dashboard: undefined;
    Plan: { screen?: keyof PlanStackParamList } | undefined;
    Focus: { task?: { id: string; title: string; subjectId: string | null; plannedMinutes: number; sessionType: import('@/screens/focus/sessionTypes').SessionType } } | undefined;
    Practice: { screen?: keyof PracticeStackParamList } | undefined;
    More: { screen?: keyof MoreStackParamList } | undefined;
};

/** Secondary app surfaces grouped behind the More tab to keep the primary tab bar usable. */
export type MoreStackParamList = {
    More: undefined;
    Notes: undefined;
    Updates: undefined;
    Tools: undefined;
    Library: undefined;
    Community: undefined;
    Analytics: undefined;
    WeeklyReview: undefined;
    ConceptCoach: undefined;
    DailyBriefing: undefined;
    OfflineManager: undefined;
    RecallStudio: undefined;
    FormulaSprint: undefined;
    ConceptMapBuilder: undefined;
    PracticeLab: undefined;
    AnswerWritingCanvas: undefined;
    WellbeingProtocol: undefined;
    GuidanceDoubts: undefined;
    AnalyticsDrilldown: undefined;
    CommunityChat: { userId: string; label?: string };
    SharedStudyDashboard: { userId: string; label?: string };
    PdfAnnotationEditor: { documentId: string; documentTitle: string; page: number; pageText?: string; annotationId?: string; quote?: string; note?: string; color?: string; updatedAt?: string };
    AccountPrivacy: undefined;
};

// ── Screen-prop helpers ─────────────────────────────────────────────────────────────────────

export type AuthStackScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
    AuthStackParamList,
    T
>;

export type OnboardingStackScreenProps<T extends keyof OnboardingStackParamList> =
    NativeStackScreenProps<OnboardingStackParamList, T>;

/** Practice-stack screen props, composed with the parent tab navigator. */
export type PracticeStackScreenProps<T extends keyof PracticeStackParamList> = CompositeScreenProps<
    NativeStackScreenProps<PracticeStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
>;

/** Notes-stack screen props, composed with the parent tab navigator. */
export type NotesStackScreenProps<T extends keyof NotesStackParamList> = CompositeScreenProps<
    NativeStackScreenProps<NotesStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = BottomTabScreenProps<
    MainTabParamList,
    T
>;

export type PlanStackScreenProps<T extends keyof PlanStackParamList> = NativeStackScreenProps<
    PlanStackParamList,
    T
>;

export type MoreStackScreenProps<T extends keyof MoreStackParamList> = NativeStackScreenProps<
    MoreStackParamList,
    T
>;
