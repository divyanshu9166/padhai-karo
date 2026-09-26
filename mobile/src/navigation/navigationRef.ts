/**
 * App-wide navigation handle for navigating from outside React screens (notification taps).
 *
 * Push payloads carry a `data.route` hint set by the backend (`Revision`, `DailyQuiz`). A tap
 * that arrives before the navigator is ready (cold start) is held and replayed once
 * {@link flushPendingNotificationRoute} runs from `NavigationContainer.onReady`.
 */
import { createNavigationContainerRef } from '@react-navigation/native';

import type { MainTabParamList } from './types';

export const navigationRef = createNavigationContainerRef<MainTabParamList>();

let pendingRoute: string | null = null;

function navigateToRoute(route: string): boolean {
    // Only the main tabs expose these routes; auth/onboarding screens ignore the tap.
    if (!navigationRef.isReady() || !navigationRef.getRootState()?.routeNames?.includes('Practice')) return false;
    if (route === 'DailyQuiz') navigationRef.navigate('Practice', { screen: 'DailyQuiz' });
    else if (route === 'Revision') navigationRef.navigate('More', { screen: 'RecallStudio' });
    return true;
}

/** Route a tapped notification, or hold it until the main app is on screen. */
export function openNotificationRoute(route: unknown): void {
    if (typeof route !== 'string' || !route) return;
    if (!navigateToRoute(route)) pendingRoute = route;
}

export function flushPendingNotificationRoute(): void {
    if (pendingRoute && navigateToRoute(pendingRoute)) pendingRoute = null;
}
