import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, deleteAccount } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import type { MoreStackScreenProps } from '@/navigation/types';
import { useAuth } from '@/state';

/** A deliberately high-friction deletion flow required for account/data-control compliance. */
export function AccountPrivacyScreen({ navigation }: MoreStackScreenProps<'AccountPrivacy'>): React.JSX.Element {
    const t = useTranslation();
    const { signOut } = useAuth();
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const removeAccount = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            await deleteAccount(password, confirmation);
            await signOut();
            Alert.alert(t('account.deletedTitle'), t('account.deletedMessage'));
        } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : t('account.deleteError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Screen title={t('account.title')}>
            <View style={styles.card}>
                <Text style={styles.heading}>{t('account.dataControl')}</Text>
                <Text style={styles.copy}>{t('account.dataControlDescription')}</Text>
                <Text style={styles.copy}>{t('account.exportHelp')}</Text>
            </View>
            <View style={[styles.card, styles.dangerCard]}>
                <Text style={styles.dangerHeading}>{t('account.deleteTitle')}</Text>
                <Text style={styles.copy}>{t('account.deleteDescription')}</Text>
                <Text style={styles.confirmation}>{t('account.deletePhrase')}</Text>
                <TextInput
                    accessibilityLabel={t('account.confirmationLabel')}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!busy}
                    onChangeText={setConfirmation}
                    placeholder={t('account.confirmationPlaceholder')}
                    style={styles.input}
                    value={confirmation}
                />
                <TextInput
                    accessibilityLabel={t('account.passwordLabel')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                    onChangeText={setPassword}
                    placeholder={t('account.passwordPlaceholder')}
                    secureTextEntry
                    style={styles.input}
                    value={password}
                />
                {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
                <Pressable
                    accessibilityLabel={t('account.deleteTitle')}
                    accessibilityRole="button"
                    disabled={busy || password.length === 0 || confirmation !== 'DELETE_MY_ACCOUNT'}
                    onPress={() => void removeAccount()}
                    style={[styles.deleteButton, (busy || password.length === 0 || confirmation !== 'DELETE_MY_ACCOUNT') && styles.disabled]}
                >
                    <Text style={styles.deleteText}>{busy ? t('common.loading') : t('account.deleteTitle')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.cancelButton}>
                    <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                </Pressable>
            </View>
        </Screen>
    );
}

const styles = StyleSheet.create({
    card: { borderWidth: 1, borderColor: '#dbeafe', borderRadius: 14, backgroundColor: '#f8fbff', padding: 16, marginBottom: 14 },
    dangerCard: { borderColor: '#fecaca', backgroundColor: '#fff7f7' },
    heading: { color: '#172554', fontSize: 17, fontWeight: '800', marginBottom: 8 },
    dangerHeading: { color: '#991b1b', fontSize: 17, fontWeight: '800', marginBottom: 8 },
    copy: { color: '#475569', lineHeight: 20, marginBottom: 8 },
    confirmation: { color: '#991b1b', fontWeight: '800', marginVertical: 8 },
    input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, backgroundColor: '#ffffff', padding: 12, color: '#0f172a' },
    error: { color: '#b91c1c', marginTop: 8 },
    deleteButton: { alignItems: 'center', backgroundColor: '#b91c1c', borderRadius: 10, marginTop: 12, padding: 12 },
    deleteText: { color: '#ffffff', fontWeight: '800' },
    disabled: { opacity: 0.5 },
    cancelButton: { alignItems: 'center', borderColor: '#94a3b8', borderRadius: 10, borderWidth: 1, marginTop: 10, padding: 11 },
    cancelText: { color: '#334155', fontWeight: '700' },
});
