/**
 * Forgot-password flow: request an emailed 6-digit code, then set a new password with it.
 *
 * Step 1 posts the email to `POST /auth/password-reset/request` (the response never reveals
 * whether the account exists). Step 2 posts `{ email, code, newPassword }` to
 * `POST /auth/password-reset/confirm`, which revokes every old session and returns a fresh
 * token, so the student lands signed in exactly like a normal login.
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, confirmPasswordReset, requestPasswordReset } from '@/api';
import { Screen } from '@/components';
import { interpolate, useTranslation } from '@/localization';
import type { AuthStackParamList } from '@/navigation/types';
import { useAuth } from '@/state';

import { authErrorMessage } from './authErrors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordScreen({ navigation }: NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>): React.JSX.Element {
    const t = useTranslation();
    const { signIn } = useAuth();
    const [step, setStep] = useState<'email' | 'code'>('email');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const sendCode = async (): Promise<void> => {
        const trimmed = email.trim();
        if (!EMAIL_PATTERN.test(trimmed)) { setError(t('auth.enterEmail')); return; }
        setError(null);
        setBusy(true);
        try {
            await requestPasswordReset(trimmed);
            setNotice(interpolate(t('auth.codeSentTo'), { email: trimmed }));
            setCode('');
            setStep('code');
        } catch (caught) {
            setError(caught instanceof ApiError && caught.code === 'TOO_MANY_ATTEMPTS' ? t('auth.tooManyAttempts') : caught instanceof ApiError ? authErrorMessage(caught) : t('auth.genericError'));
        } finally {
            setBusy(false);
        }
    };

    const resetPassword = async (): Promise<void> => {
        if (!/^\d{6}$/.test(code.trim()) || newPassword.length === 0) { setError(t('auth.enterCodeAndPassword')); return; }
        setError(null);
        setBusy(true);
        try {
            const { token, user } = await confirmPasswordReset({ email: email.trim(), code: code.trim(), newPassword });
            await signIn(token, user);
        } catch (caught) {
            if (caught instanceof ApiError && caught.code === 'INVALID_RESET_CODE') setError(t('auth.invalidCode'));
            else if (caught instanceof ApiError && caught.code === 'TOO_MANY_ATTEMPTS') setError(t('auth.tooManyAttempts'));
            else setError(caught instanceof ApiError ? authErrorMessage(caught) : t('auth.genericError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Screen title={t('auth.resetTitle')}>
            <View style={styles.form}>
                {step === 'email' ? (
                    <>
                        <Text style={styles.intro}>{t('auth.resetIntro')}</Text>
                        <Text style={styles.label}>{t('auth.email')}</Text>
                        <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" placeholderTextColor="#9ca3af" editable={!busy} accessibilityLabel={t('auth.email')} onSubmitEditing={() => void sendCode()} />
                    </>
                ) : (
                    <>
                        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
                        <Text style={styles.label}>{t('auth.resetCode')}</Text>
                        <TextInput style={[styles.input, styles.code]} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} placeholder="123456" placeholderTextColor="#9ca3af" editable={!busy} accessibilityLabel={t('auth.resetCode')} />
                        <Text style={styles.label}>{t('auth.newPassword')}</Text>
                        <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" placeholder="••••••••" placeholderTextColor="#9ca3af" editable={!busy} accessibilityLabel={t('auth.newPassword')} />
                        <Text style={styles.hint}>{t('auth.passwordRules')}</Text>
                    </>
                )}

                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

                <Pressable style={[styles.submit, busy && styles.submitDisabled]} disabled={busy} accessibilityRole="button" onPress={() => void (step === 'email' ? sendCode() : resetPassword())}>
                    {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitText}>{step === 'email' ? t('auth.sendCode') : t('auth.resetSubmit')}</Text>}
                </Pressable>

                {step === 'code' ? (
                    <Pressable style={styles.link} disabled={busy} accessibilityRole="button" onPress={() => void sendCode()}>
                        <Text style={styles.linkText}>{t('auth.resendCode')}</Text>
                    </Pressable>
                ) : null}
                <Pressable style={styles.link} disabled={busy} accessibilityRole="button" onPress={() => navigation.navigate('Login')}>
                    <Text style={styles.linkText}>{t('auth.backToLogin')}</Text>
                </Pressable>
            </View>
        </Screen>
    );
}

const styles = StyleSheet.create({
    form: { marginTop: 8 },
    intro: { color: '#475569', fontSize: 15, lineHeight: 22 },
    notice: { color: '#1e3a8a', backgroundColor: '#eff6ff', borderRadius: 8, padding: 12, lineHeight: 20 },
    label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 14 },
    input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#111827', backgroundColor: '#ffffff' },
    code: { fontSize: 22, letterSpacing: 6, textAlign: 'center' },
    hint: { color: '#64748b', fontSize: 13, marginTop: 6, lineHeight: 18 },
    error: { color: '#b91c1c', fontSize: 14, marginTop: 12, lineHeight: 20 },
    submit: { marginTop: 24, backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
    submitDisabled: { backgroundColor: '#93c5fd' },
    submitText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
    link: { marginTop: 16, alignItems: 'center' },
    linkText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
});
