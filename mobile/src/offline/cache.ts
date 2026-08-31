import AsyncStorage from '@react-native-async-storage/async-storage';

export async function cacheJson<T>(key: string, value: T): Promise<void> {
    await AsyncStorage.setItem('offline:cache:' + key, JSON.stringify({ cachedAt: new Date().toISOString(), value }));
}

export async function readCachedJson<T>(key: string): Promise<{ cachedAt: string; value: T } | null> {
    try {
        const raw = await AsyncStorage.getItem('offline:cache:' + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { cachedAt?: unknown; value?: T };
        return typeof parsed.cachedAt === 'string' && parsed.value !== undefined ? { cachedAt: parsed.cachedAt, value: parsed.value } : null;
    } catch { return null; }
}

export async function clearCachedJson(key: string): Promise<void> {
    await AsyncStorage.removeItem('offline:cache:' + key);
}
