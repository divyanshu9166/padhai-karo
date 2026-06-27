/**
 * Secure session-token storage (task 21.1).
 *
 * The session token is a bearer credential, so it is stored in the device keychain/keystore via
 * `expo-secure-store` when available. SecureStore is unavailable on web (and reports so via
 * `isAvailableAsync`), so this module falls back to `AsyncStorage`. The chosen backend is
 * resolved once, lazily, and cached.
 *
 * Only the opaque session token is persisted here. User profile data is re-fetched from
 * `GET /auth/me` on startup rather than cached, so it never goes stale.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'session_token';

/** The minimal surface both backends share. */
interface KeyValueStore {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
}

/** Adapt expo-secure-store to {@link KeyValueStore}. */
const secureStore: KeyValueStore = {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
};

let storePromise: Promise<KeyValueStore> | null = null;

/** Resolve the best available store once: SecureStore when supported, else AsyncStorage. */
function getStore(): Promise<KeyValueStore> {
    if (storePromise === null) {
        storePromise = (async () => {
            try {
                if (await SecureStore.isAvailableAsync()) {
                    return secureStore;
                }
            } catch {
                // Fall through to AsyncStorage if availability cannot be determined.
            }
            return AsyncStorage as KeyValueStore;
        })();
    }
    return storePromise;
}

/** Read the persisted session token, or `null` if none is stored. */
export async function getToken(): Promise<string | null> {
    const store = await getStore();
    return store.getItem(TOKEN_KEY);
}

/** Persist the session token securely. */
export async function setToken(token: string): Promise<void> {
    const store = await getStore();
    await store.setItem(TOKEN_KEY, token);
}

/** Remove the persisted session token (logout / invalid session). */
export async function clearToken(): Promise<void> {
    const store = await getStore();
    await store.removeItem(TOKEN_KEY);
}
