/**
 * Shared email/password form used by the Login and Register screens (task 21.2).
 *
 * Presentational + local-state only: it owns the email/password fields, basic client-side
 * presence checks, a submitting state, and rendering of a server/validation error banner.
 * The actual API call (POST /auth/login or /auth/register) and the resulting `signIn` are
 * injected via `onSubmit`, so this component stays free of routing and API concerns and is
 * reused verbatim by both screens.
 */
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { useTranslation } from '@/localization';

import { ApiError } from '@/api';

import { authErrorMessage } from './authErrors';

interface AuthFormProps {
    /** Primary submit label (e.g. "Log in" / "Create account"). */
    submitLabel: string;
    /** Performs the API call; throws on failure so the form can surface the message. */
    onSubmit: (email: string, password: string) => Promise<void>;
    /** Label for the link to the other auth screen. */
    switchLabel: string;
    /** Navigate to the other auth screen. */
    onSwitch: () => void;
}

export function AuthForm({
    submitLabel,
    onSubmit,
    switchLabel,
    onSwitch,
}: AuthFormProps): React.JSX.Element {
    const t = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

    async function handleSubmit(): Promise<void> {
        if (submitting) return;
        // Presence check before hitting the network; the server remains the source of truth
        // for format/policy/credential validation (Req 1.1, 1.4).
        if (email.trim().length === 0 || password.length === 0) {
            setError(t('auth.missingFields'));
            return;
        }
        setError(null);
        setSubmitting(true);
        try {
            await onSubmit(email.trim(), password);
            // On success the auth state advances the navigator; nothing else to do here.
        } catch (err) {
            // ApiError carries a server-authored, precise message (weak password 422 with the
            // unmet requirement, duplicate email 409, invalid credentials 401); anything else
            // is a transport failure that never reached a verdict (Req 1.1, 1.4).
            setError(err instanceof ApiError ? authErrorMessage(err) : t('auth.genericError'));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <View style={styles.form}>
            <Text style={styles.label}>{t('auth.email')}</Text>
            <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
                placeholderTextColor="#9ca3af"
                editable={!submitting}
                accessibilityLabel={t('auth.email')}
            />

            <Text style={styles.label}>{t('auth.password')}</Text>
            <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                placeholder="••••••••"
                placeholderTextColor="#9ca3af"
                editable={!submitting}
                accessibilityLabel={t('auth.password')}
            />

            {error ? (
                <Text style={styles.error} accessibilityRole="alert">
                    {error}
                </Text>
            ) : null}

            <Pressable
                style={[styles.submit, !canSubmit && styles.submitDisabled]}
                onPress={() => void handleSubmit()}
                disabled={!canSubmit}
                accessibilityRole="button"
            >
                {submitting ? (
                    <ActivityIndicator color="#ffffff" />
                ) : (
                    <Text style={styles.submitText}>{submitLabel}</Text>
                )}
            </Pressable>

            <Pressable
                style={styles.switch}
                onPress={onSwitch}
                disabled={submitting}
                accessibilityRole="button"
            >
                <Text style={styles.switchText}>{switchLabel}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    form: { marginTop: 8 },
    label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 14 },
    input: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
        color: '#111827',
        backgroundColor: '#ffffff',
    },
    error: { color: '#b91c1c', fontSize: 14, marginTop: 12, lineHeight: 20 },
    submit: {
        marginTop: 24,
        backgroundColor: '#2563eb',
        borderRadius: 8,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
    },
    submitDisabled: { backgroundColor: '#93c5fd' },
    submitText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
    switch: { marginTop: 16, alignItems: 'center' },
    switchText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
});
