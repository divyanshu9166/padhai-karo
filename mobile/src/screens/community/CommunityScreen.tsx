import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError } from '@/api';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import { createCommunityPost, getBuddies, getBuddyMatches, getCommunityMessages, getCommunityPosts, getSharedDashboard, reportCommunityContent, requestBuddy, sendCommunityMessage, shareDashboard, updateBuddy, type BuddyMatch, type BuddyRequest, type CommunityMessage, type CommunityPost, type SharedDashboard } from '@/api/upscProduct';
import { CommunitySocket } from '@/realtime/communitySocket';

export function CommunityScreen(): React.JSX.Element {
    const t = useTranslation();
    const [matches, setMatches] = useState<BuddyMatch[]>([]);
    const [sent, setSent] = useState<BuddyRequest[]>([]);
    const [received, setReceived] = useState<BuddyRequest[]>([]);
    const [selectedUser, setSelectedUser] = useState<string | null>(null);
    const [messages, setMessages] = useState<CommunityMessage[]>([]);
    const [messageText, setMessageText] = useState('');
    const [dashboard, setDashboard] = useState<SharedDashboard | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [posts, setPosts] = useState<CommunityPost[]>([]);
    const [postTitle, setPostTitle] = useState('');
    const [postBody, setPostBody] = useState('');
    const lastMessageAt = useRef<string | undefined>(undefined);
    const selectedUserRef = useRef<string | null>(null);
    const realtimeRef = useRef<CommunitySocket | null>(null);
    const [realtimeConnected, setRealtimeConnected] = useState(false);

    const load = useCallback(async (): Promise<void> => {
        try {
            const [matchResult, buddyResult, postResult] = await Promise.all([getBuddyMatches(), getBuddies(), getCommunityPosts()]);
            setMatches(matchResult.matches); setSent(buddyResult.sent); setReceived(buddyResult.received); setPosts(postResult.posts as CommunityPost[]);
        } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.loadError')); }
    }, [t]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
    useEffect(() => {
        const realtime = new CommunitySocket();
        realtimeRef.current = realtime;
        const unsubscribe = realtime.subscribe((event) => {
            if (event.type === 'status') setRealtimeConnected(event.status === 'connected');
            if (event.type === 'error') setMessage(event.message);
            if (event.type === 'message' && selectedUserRef.current && (event.message.senderId === selectedUserRef.current || event.message.recipientId === selectedUserRef.current)) {
                const timestamps = [lastMessageAt.current, event.message.createdAt].filter((value): value is string => Boolean(value)).sort();
                lastMessageAt.current = timestamps[timestamps.length - 1];
                setMessages((current) => Array.from(new Map([...current, event.message].map((item) => [item.id, item])).values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
            }
        });
        realtime.connect();
        return () => { unsubscribe(); realtime.close(); realtimeRef.current = null; };
    }, []);
    useEffect(() => {
        if (!selectedUser) return;
        let active = true;
        lastMessageAt.current = undefined;
        const refreshMessages = async (): Promise<void> => {
            try {
                const next = await getCommunityMessages(selectedUser, lastMessageAt.current);
                if (!active) return;
                setMessages((current) => {
                    const merged = lastMessageAt.current ? [...current, ...next.messages] : next.messages;
                    const unique = Array.from(new Map(merged.map((item) => [item.id, item])).values());
                    const latest = unique[unique.length - 1];
                    if (latest) lastMessageAt.current = latest.createdAt;
                    return unique;
                });
            } catch { /* keep the last conversation visible during a transient poll failure */ }
        };
        void refreshMessages();
        const timer = realtimeConnected ? undefined : setInterval(() => { void refreshMessages(); }, 10_000);
        return () => { active = false; if (timer) clearInterval(timer); };
    }, [realtimeConnected, selectedUser]);

    const accepted = useMemo(() => [...sent.map((item) => ({ ...item, other: item.recipientId })), ...received.map((item) => ({ ...item, other: item.requesterId }))].filter((item): item is BuddyRequest & { other: string } => item.status === 'ACCEPTED' && Boolean(item.other)), []);
    const chooseBuddy = async (userId: string): Promise<void> => { setSelectedUser(userId); setDashboard(null); lastMessageAt.current = undefined; try { const result = await getCommunityMessages(userId); setMessages(result.messages); const latest = result.messages[result.messages.length - 1]; lastMessageAt.current = latest?.createdAt; } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.messagingUnavailable')); } };
    const send = async (): Promise<void> => { if (!selectedUser || !messageText.trim()) return; setBusy(true); try { const body = messageText.trim(); if (realtimeConnected && realtimeRef.current?.sendMessage(selectedUser, body)) { setMessageText(''); } else { await sendCommunityMessage(selectedUser, body); setMessageText(''); const next = await getCommunityMessages(selectedUser, lastMessageAt.current); setMessages((current) => { const merged = Array.from(new Map([...current, ...next.messages].map((item) => [item.id, item])).values()); lastMessageAt.current = merged[merged.length - 1]?.createdAt; return merged; }); } } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.sendError')); } finally { setBusy(false); } };
    const share = async (): Promise<void> => { if (!selectedUser) return; try { await shareDashboard(selectedUser); setMessage(t('community.shareDashboard')); } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.shareError')); } };
    const viewDashboard = async (): Promise<void> => { if (!selectedUser) return; try { setDashboard((await getSharedDashboard(selectedUser)).dashboard); } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.dashboardUnavailable')); } };
    const publishPost = async (): Promise<void> => { if (!postTitle.trim() || !postBody.trim()) { setMessage(t('community.postBody')); return; } setBusy(true); try { await createCommunityPost({ title: postTitle.trim(), body: postBody.trim(), anonymous: true }); setPostTitle(''); setPostBody(''); setMessage(t('community.publish')); setPosts((await getCommunityPosts()).posts as CommunityPost[]); } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.publishError')); } finally { setBusy(false); } };

    return <Screen title={t('community.title')}><ScrollView contentContainerStyle={styles.scroll}>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.card}><Text style={styles.heading}>{t('community.heading')}</Text><TextInput style={styles.input} value={postTitle} onChangeText={setPostTitle} placeholder={t('community.postTitle')} /><TextInput style={[styles.input, styles.multiline]} value={postBody} onChangeText={setPostBody} placeholder={t('community.postBody')} multiline /><Pressable style={styles.secondary} onPress={() => void publishPost()} disabled={busy}><Text style={styles.secondaryText}>{t('community.publish')}</Text></Pressable>{posts.slice(0, 10).map((post) => <View key={post.id} style={styles.post}><Text style={styles.bold}>{post.title}</Text><Text style={styles.muted}>{post.authorLabel} · {post.createdAt.slice(0, 10)}</Text><Text style={styles.chat}>{post.body}</Text><Text style={styles.report} onPress={() => void (async () => { try { await reportCommunityContent({ postId: post.id, reason: 'User report from community feed' }); setMessage(t('community.reportSent')); } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.reportError')); } })()}>{t('community.report')}</Text></View>)}</View>
        <View style={styles.card}><Text style={styles.heading}>{t('community.buddiesHeading')}</Text>{matches.length === 0 ? <Text style={styles.muted}>{t('community.noMatches')}</Text> : matches.slice(0, 8).map((match) => <View key={match.userId} style={styles.row}><View style={styles.flex}><Text style={styles.bold}>{match.examProgram || 'Aspirant'} · {match.examStage || 'stage match'}</Text><Text style={styles.muted}>{match.reason} · {match.matchScore}% fit</Text></View><Pressable style={styles.secondary} onPress={() => void (async () => { try { await requestBuddy(match.userId); setMessage(t('community.requestSent')); await load(); } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.requestError')); } })()}><Text style={styles.secondaryText}>{t('community.connect')}</Text></Pressable></View>)}</View>
        {received.filter((item) => item.status === 'PENDING').length > 0 ? <View style={styles.card}><Text style={styles.heading}>{t('community.incoming')}</Text>{received.filter((item) => item.status === 'PENDING').map((item) => <View key={item.id} style={styles.row}><Text style={styles.flex}>{t('community.request')}</Text><Pressable style={[styles.secondary, busy && styles.disabled]} disabled={busy} onPress={() => void (async () => { setBusy(true); try { await updateBuddy(item.id, 'ACCEPTED'); setMessage(t('community.accept')); await load(); } catch (error) { setMessage(error instanceof ApiError ? error.message : t('community.acceptError')); } finally { setBusy(false); } })()}><Text style={styles.secondaryText}>{t('community.accept')}</Text></Pressable></View>)}</View> : null}
        <View style={styles.card}><Text style={styles.heading}>{t('community.messagingHeading')}</Text>{accepted.length === 0 ? <Text style={styles.muted}>{t('community.noBuddy')}</Text> : accepted.map((item) => <Pressable key={item.id} style={[styles.buddy, selectedUser === item.other && styles.selected]} onPress={() => void chooseBuddy(item.other)}><Text style={styles.bold}>Buddy {item.other.slice(0, 8)}</Text><Text style={styles.muted}>{t('community.accepted')}</Text></Pressable>)}{selectedUser ? <><TextInput style={styles.input} value={messageText} onChangeText={setMessageText} placeholder={t('community.messagePlaceholder')} /><View style={styles.buttonRow}><Pressable style={styles.secondary} onPress={() => void send()} disabled={busy}><Text style={styles.secondaryText}>{t('community.send')}</Text></Pressable><Pressable style={styles.secondary} onPress={() => void share()}><Text style={styles.secondaryText}>{t('community.shareDashboard')}</Text></Pressable><Pressable style={styles.secondary} onPress={() => void viewDashboard()}><Text style={styles.secondaryText}>{t('community.viewDashboard')}</Text></Pressable></View>{messages.slice(-10).map((item) => <Text key={item.id} style={styles.chat}>{item.body}</Text>)}{dashboard ? <Text style={styles.dashboard}>Shared last 7 days: {dashboard.focusMinutes} focus minutes across {dashboard.focusSessions} sessions.</Text> : null}</> : null}</View>
    </ScrollView></Screen>;
}

const styles = StyleSheet.create({ scroll: { paddingBottom: 32 }, card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 12 }, heading: { fontWeight: '800', fontSize: 16, color: '#111827', marginBottom: 8 }, bold: { fontWeight: '700', color: '#111827' }, muted: { color: '#6b7280', lineHeight: 19 }, message: { color: '#15803d', marginBottom: 10 }, row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingVertical: 9 }, flex: { flex: 1 }, secondary: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, padding: 9, marginLeft: 8 }, secondaryText: { color: '#2563eb', fontWeight: '700' }, disabled: { opacity: 0.5 }, buddy: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 10, marginTop: 8 }, selected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' }, input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, marginTop: 10, color: '#111827' }, multiline: { minHeight: 70, textAlignVertical: 'top' }, post: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 10, marginTop: 10 }, report: { color: '#b91c1c', marginTop: 7 }, buttonRow: { flexDirection: 'row', flexWrap: 'wrap' }, chat: { color: '#374151', backgroundColor: '#f3f4f6', borderRadius: 8, padding: 8, marginTop: 7 }, dashboard: { color: '#15803d', fontWeight: '700', marginTop: 10 },
});
