/** Validate production endpoints before any authenticated request can leave the device. */
export function validateProductionEndpoints(apiBaseUrl: string, wsUrl: string, isDevelopment: boolean): void {
    if (isDevelopment) return;
    if (!/^https:\/\//i.test(apiBaseUrl)) {
        throw new Error('Production API must use HTTPS. Set EXPO_PUBLIC_API_BASE_URL to an https:// URL.');
    }
    if (!/^wss:\/\//i.test(wsUrl)) {
        throw new Error('Production community socket must use WSS. Set EXPO_PUBLIC_WS_URL to a wss:// URL.');
    }
}
