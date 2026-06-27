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
};

/** Onboarding flow (authenticated, not-yet-onboarded users — Req 2.6). */
export type OnboardingStackParamList = {
    Onboarding: undefined;
};

/** Practice tab stack — PYQ practice, Timed Paper mode, Mistake journal (task 21.6). */
export type PracticeStackParamList = {
    Pyq: undefined;
    /** A paper id may be passed in to auto-start Timed Paper Mode. */
    TimedPaper: { paperId?: string } | undefined;
    MistakeJournal: undefined;
};

/** Notes tab stack — AI notes summarizer + subscription/paywall (task 21.7). */
export type NotesStackParamList = {
    AiNotes: undefined;
    Paywall: undefined;
};

/** Main app bottom tabs (authenticated + onboarded users). */
export type MainTabParamList = {
    Dashboard: undefined;
    Timetable: undefined;
    Focus: undefined;
    Practice: undefined;
    Notes: undefined;
    Nta: undefined;
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
