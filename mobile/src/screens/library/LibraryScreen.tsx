import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, getAuthToken } from '@/api';
import { API_BASE_URL } from '@/config/env';
import { Screen } from '@/components';
import { useTranslation } from '@/localization';
import { cacheJson, readCachedJson } from '@/offline/cache';
import { useOffline } from '@/offline';
import { queueMutation } from '@/offline/mutations';
import { queuePdfUpload } from '@/offline/pendingMedia';
import { createPdfAnnotation, createResource, deletePdfAnnotation, deleteResource, getPdfAnnotations, getPdfDocuments, getPdfPageImageUrl, getStudyResources, updatePdfAnnotation, updateResource, uploadPdfDocument, type PdfAnnotation, type PdfDocument } from '@/api/upscProduct';

type StudyResource = { id: string; title: string; url?: string | null; type?: string; tags?: string[]; completed?: boolean; updatedAt?: string };
const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
function openableUrl(value: string): string { return value.startsWith('/') ? apiOrigin + value : value; }
function pagesOf(document: PdfDocument): string[] { return Array.isArray(document.pageText) ? document.pageText.filter((value): value is string => typeof value === 'string') : document.extractedText ? document.extractedText.split('\f').map((page) => page.trim()).filter(Boolean) : []; }
function offlineDocumentId(): string { return 'offline-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); }
function hydratePdfDocument(document: PdfDocument, media: Record<string, string>): PdfDocument {
    const pageImageUris: Record<string, string> = {};
    for (const [key, uri] of Object.entries(media)) {
        const prefix = `pdf-page:${document.id}:`;
        if (key.startsWith(prefix)) pageImageUris[key.slice(prefix.length)] = uri;
    }
    return { ...document, ...(media[`pdf:${document.id}`] ? { localUri: media[`pdf:${document.id}`] } : {}), ...(Object.keys(pageImageUris).length > 0 ? { pageImageUris } : {}) };
}
function pageImagePath(documentId: string, page: number): string | null { return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}padhaikaro-offline/pdf-pages/${documentId}-${page}.png` : null; }

export function LibraryScreen(): React.JSX.Element {
    const t = useTranslation();
    const { isOffline } = useOffline();
    const [documents, setDocuments] = useState<PdfDocument[]>([]);
    const [selected, setSelected] = useState<PdfDocument | null>(null);
    const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
    const [page, setPage] = useState(1);
    const [pageImageUri, setPageImageUri] = useState<string | null>(null);
    const [pageImageLoading, setPageImageLoading] = useState(false);
    const [continuousReading, setContinuousReading] = useState(false);
    const [readerQuery, setReaderQuery] = useState('');
    const [note, setNote] = useState('');
    const [quote, setQuote] = useState('');
    const [editingAnnotation, setEditingAnnotation] = useState<PdfAnnotation | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [resources, setResources] = useState<StudyResource[]>([]);
    const [resourceTitle, setResourceTitle] = useState('');
    const [resourceUrl, setResourceUrl] = useState('');
    const [editingResource, setEditingResource] = useState<StudyResource | null>(null);

    const load = useCallback(async (search = ''): Promise<void> => {
        try {
            const [pdfResult, resourceResult, mediaCache] = await Promise.all([getPdfDocuments(search), getStudyResources(), readCachedJson<Record<string, string>>('workspace-media')]);
            const media = mediaCache?.value ?? {};
            const next = pdfResult.documents.map((document) => hydratePdfDocument(document, media)); const nextResources = resourceResult.resources as StudyResource[];
            setDocuments(next); setResources(nextResources);
            await Promise.all([cacheJson('library-pdfs' + (search ? ':' + search : ''), next), cacheJson('library-resources', nextResources)]);
        } catch {
            const [cachedPdfs, cachedResources, localPdfs, mediaCache] = await Promise.all([readCachedJson<PdfDocument[]>('library-pdfs' + (search ? ':' + search : '')), readCachedJson<StudyResource[]>('library-resources'), readCachedJson<PdfDocument[]>('library-offline-pdfs'), readCachedJson<Record<string, string>>('workspace-media')]);
            const media = mediaCache?.value ?? {};
            const merged = [...(localPdfs?.value ?? []), ...(cachedPdfs?.value ?? [])].map((document) => hydratePdfDocument(document, media)).filter((document, index, list) => list.findIndex((item) => item.id === document.id) === index);
            setDocuments(merged); setResources(cachedResources?.value ?? []);
        }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const pickPdf = async (): Promise<void> => {
        const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
        if (result.canceled || !result.assets[0]) return;
        setBusy(true); setMessage(null);
        try {
            const asset = result.assets[0]; const title = asset.name.replace(/\.pdf$/i, '');
            if (isOffline) {
                const queued = await queuePdfUpload({ uri: asset.uri, name: asset.name, tags: ['library', 'offline-pending'] });
                const localDocument: PdfDocument = { id: offlineDocumentId(), title, fileUrl: queued.uri, localUri: queued.uri, pageCount: null, tags: ['library', 'offline-pending'] };
                const cached = await readCachedJson<PdfDocument[]>('library-offline-pdfs');
                await cacheJson('library-offline-pdfs', [localDocument, ...(cached?.value ?? [])]);
                setDocuments((items) => [localDocument, ...items]); setMessage('PDF copied to durable offline storage and queued for upload.'); return;
            }
            const created = await uploadPdfDocument(asset.uri, asset.name, ['library', 'uploaded']);
            setDocuments((items) => [{ ...created.document, localUri: asset.uri }, ...items]);
            setMessage(created.searchable ? 'PDF uploaded with page-wise text search.' : 'PDF uploaded without extractable text.');
        } catch (error) { setMessage(error instanceof ApiError ? error.message : 'Could not add the PDF.'); }
        finally { setBusy(false); }
    };

    const selectDocument = async (document: PdfDocument): Promise<void> => {
        setSelected(document); setPage(1); setPageImageUri(null); setEditingAnnotation(null); setReaderQuery(''); setContinuousReading(false);
        if (document.id.startsWith('offline-')) { setAnnotations((await readCachedJson<PdfAnnotation[]>('pdf-annotations:' + document.id))?.value ?? []); return; }
        try { const next = (await getPdfAnnotations(document.id)).annotations; setAnnotations(next); await cacheJson('pdf-annotations:' + document.id, next); }
        catch { setAnnotations((await readCachedJson<PdfAnnotation[]>('pdf-annotations:' + document.id))?.value ?? []); }
    };

    const downloadPageImage = useCallback(async (documentId: string, pageNumber: number): Promise<string | null> => {
        const target = pageImagePath(documentId, pageNumber);
        if (!target) return null;
        const directory = FileSystem.documentDirectory;
        if (!directory) return null;
        await FileSystem.makeDirectoryAsync(directory + 'padhaikaro-offline/pdf-pages/', { intermediates: true });
        const existing = await FileSystem.getInfoAsync(target);
        if (existing.exists && (!('size' in existing) || typeof existing.size !== 'number' || existing.size > 0)) return target;
        const partial = target + '.part';
        await FileSystem.deleteAsync(partial, { idempotent: true });
        const result = await FileSystem.downloadAsync(openableUrl(getPdfPageImageUrl(documentId, pageNumber)), partial, { headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}, md5: true });
        if (result.status >= 400) throw new Error(`Page render failed (${result.status}).`);
        await FileSystem.deleteAsync(target, { idempotent: true });
        await FileSystem.moveAsync({ from: result.uri, to: target });
        return target;
    }, []);

    const ensurePageImage = useCallback(async (document: PdfDocument, pageNumber: number): Promise<void> => {
        if (document.id.startsWith('offline-')) { setPageImageUri(null); return; }
        setPageImageLoading(true);
        try {
            const hydrated = document.pageImageUris?.[String(pageNumber)];
            if (hydrated && (await FileSystem.getInfoAsync(hydrated)).exists) { setPageImageUri(hydrated); return; }
            const local = pageImagePath(document.id, pageNumber);
            const existing = local ? await FileSystem.getInfoAsync(local) : { exists: false };
            if (existing.exists) { setPageImageUri(local); return; }
            if (isOffline) { setPageImageUri(null); return; }
            setPageImageUri(await downloadPageImage(document.id, pageNumber));
        } catch { setPageImageUri(null); }
        finally { setPageImageLoading(false); }
    }, [downloadPageImage, isOffline]);

    useEffect(() => {
        if (!selected) return;
        void ensurePageImage(selected, page);
    }, [ensurePageImage, page, selected]);

    const downloadPdfOffline = async (document: PdfDocument): Promise<void> => {
        if (isOffline) { setMessage('Reconnect to download this PDF.'); return; }
        if (!document.fileUrl || !FileSystem.documentDirectory) return;
        setBusy(true); setMessage(null);
        try {
            const directory = FileSystem.documentDirectory + 'padhaikaro-offline/library/';
            await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
            const safeName = (document.fileName || document.title || document.id).replace(/[^a-zA-Z0-9._-]/g, '_');
            const target = directory + `${document.id}-${safeName}`;
            const partial = target + '.part';
            await FileSystem.deleteAsync(partial, { idempotent: true });
            const result = await FileSystem.downloadAsync(openableUrl(document.fileUrl), partial, { headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}, md5: true });
            if (result.status >= 400) throw new Error(`Download failed (${result.status}).`);
            await FileSystem.deleteAsync(target, { idempotent: true });
            await FileSystem.moveAsync({ from: result.uri, to: target });
            let renderedPages = 0;
            if (document.pageCount && document.pageCount > 0) {
                for (let pageNumber = 1; pageNumber <= document.pageCount; pageNumber += 1) {
                    if (await downloadPageImage(document.id, pageNumber)) renderedPages += 1;
                }
            }
            // `result.uri` is the temporary `.part` path after the atomic move. Keep the
            // final target in the document model, otherwise reopening the library points at
            // a file that no longer exists and the PDF appears to have vanished offline.
            const updated = { ...document, localUri: target };
            setDocuments((items) => items.map((item) => item.id === document.id ? updated : item));
            if (selected?.id === document.id) setSelected(updated);
            await cacheJson('library-offline-pdfs', [updated, ...(await readCachedJson<PdfDocument[]>('library-offline-pdfs'))?.value?.filter((item) => item.id !== document.id) ?? []]);
            setPageImageUri(pageImagePath(document.id, page) ?? null);
            setMessage(renderedPages > 0 ? `PDF and ${renderedPages} visual pages saved for offline reading.` : 'PDF saved for offline reading. Visual pages will download when online.');
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save PDF offline.'); }
        finally { setBusy(false); }
    };

    const saveAnnotation = async (): Promise<void> => {
        if (!selected || !note.trim()) return;
        setBusy(true); setMessage(null);
        try {
            const pageText = pagesOf(selected)[page - 1] ?? ''; const offset = quote.trim() ? pageText.indexOf(quote.trim()) : -1;
            if (editingAnnotation) {
                const updated = selected.id.startsWith('offline-') ? { ...editingAnnotation, page, quote: quote.trim() || null, note: note.trim(), selectionStart: offset >= 0 ? offset : null, selectionEnd: offset >= 0 ? offset + quote.trim().length : null, updatedAt: new Date().toISOString() } : (await updatePdfAnnotation(editingAnnotation.id, { page, quote: quote.trim() || null, note: note.trim(), selectionStart: offset >= 0 ? offset : null, selectionEnd: offset >= 0 ? offset + quote.trim().length : null, ...(editingAnnotation.updatedAt ? { baseUpdatedAt: editingAnnotation.updatedAt } : {}) })).annotation;
                const next = annotations.map((item) => item.id === editingAnnotation.id ? updated : item); setAnnotations(next); await cacheJson('pdf-annotations:' + selected.id, next); setMessage('Annotation updated.');
            } else {
                const input = { documentId: selected.id, page, note: note.trim(), quote: quote.trim(), type: quote.trim() ? 'HIGHLIGHT' : 'NOTE', selectionStart: offset >= 0 ? offset : undefined, selectionEnd: offset >= 0 ? offset + quote.trim().length : undefined } as const;
                const annotation = selected.id.startsWith('offline-') ? { id: 'local-' + Date.now(), ...input, color: '#facc15', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : (await createPdfAnnotation(input)).annotation;
                const next = [...annotations, annotation]; setAnnotations(next); await cacheJson('pdf-annotations:' + selected.id, next); setMessage('Annotation saved.');
            }
            setEditingAnnotation(null); setNote(''); setQuote('');
        } catch (error) { setMessage(error instanceof ApiError ? error.message : 'Could not save annotation.'); }
        finally { setBusy(false); }
    };

    const removeAnnotation = async (annotation: PdfAnnotation): Promise<void> => {
        if (!selected) return;
        try { if (!selected.id.startsWith('offline-')) await deletePdfAnnotation(annotation.id, annotation.updatedAt); const next = annotations.filter((item) => item.id !== annotation.id); setAnnotations(next); await cacheJson('pdf-annotations:' + selected.id, next); setMessage('Annotation deleted.'); }
        catch (error) { setMessage(error instanceof ApiError ? error.message : 'Could not delete annotation.'); }
    };

    const saveResource = async (): Promise<void> => {
        if (!resourceTitle.trim()) return;
        const input = { title: resourceTitle.trim(), url: resourceUrl.trim() || undefined, type: 'LINK', tags: ['library'] };
        setBusy(true); setMessage(null);
        try {
            if (editingResource) {
                if (isOffline) await queueMutation('RESOURCE_UPDATE', { id: editingResource.id, ...input, ...(editingResource.updatedAt ? { baseUpdatedAt: editingResource.updatedAt } : {}) }); else await updateResource(editingResource.id, input);
                setResources((items) => items.map((item) => item.id === editingResource.id ? { ...item, ...input } : item)); setMessage(isOffline ? 'Resource edit queued for sync.' : 'Resource updated.');
            } else if (isOffline) {
                const localId = 'offline-resource-' + Date.now();
                await queueMutation('RESOURCE_CREATE', { id: localId, title: input.title, url: input.url, resourceType: input.type, tags: input.tags });
                setResources((items) => [{ id: localId, ...input }, ...items]); setMessage('Resource saved offline and queued for sync.');
            } else { const created = await createResource(input); setResources((items) => [created.resource as StudyResource, ...items]); setMessage('Resource saved.'); }
            setEditingResource(null); setResourceTitle(''); setResourceUrl('');
        } catch (error) { setMessage(error instanceof ApiError ? error.message : 'Could not save resource.'); }
        finally { setBusy(false); }
    };

    const readerPages = useMemo(() => selected ? pagesOf(selected) : [], [selected]);
    const currentPage = readerPages[page - 1] ?? '';
    const totalPages = selected?.pageCount ?? readerPages.length;
    const matchingPages = useMemo(() => {
        const needle = readerQuery.trim().toLocaleLowerCase();
        if (!needle) return [];
        return readerPages.flatMap((pageText, index) => pageText.toLocaleLowerCase().includes(needle) ? [index + 1] : []);
    }, [readerPages, readerQuery]);
    const setReaderPage = (nextPage: number): void => {
        if (totalPages <= 0) return;
        setPage(Math.max(1, Math.min(totalPages, Math.floor(nextPage))));
    };

    return <Screen title={t('library.title')}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInput style={styles.input} value={query} onChangeText={setQuery} onSubmitEditing={() => void load(query)} placeholder={t('library.searchPlaceholder')} returnKeyType="search" />
        <Pressable style={styles.button} onPress={() => void pickPdf()} disabled={busy}><Text style={styles.buttonText}>{busy ? t('common.working') : t('library.addPdf')}</Text></Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {documents.length === 0 ? <Text style={styles.muted}>{t('library.empty')}</Text> : documents.map((document) => <Pressable key={document.id} style={[styles.card, selected?.id === document.id && styles.selected]} onPress={() => void selectDocument(document)}><Text style={styles.heading}>{document.title}</Text><Text style={styles.muted}>{document.pageCount ? document.pageCount + ' ' + t('common.pages') : t('library.pdfDocument')} · {document.tags.join(', ')}</Text>{document.fileUrl || document.localUri ? <Text style={styles.link} onPress={() => void Linking.openURL(openableUrl(document.localUri ?? document.fileUrl ?? ''))}>{t('library.openFile')}</Text> : null}{document.fileUrl && !document.localUri && !isOffline ? <Text style={styles.link} onPress={() => void downloadPdfOffline(document)}>{t('common.saveOffline')}</Text> : null}</Pressable>)}
        <View style={styles.card}><Text style={styles.heading}>{t('library.resources')}</Text><TextInput style={styles.input} value={resourceTitle} onChangeText={setResourceTitle} placeholder={t('library.resourceTitle')} /><TextInput style={styles.input} value={resourceUrl} onChangeText={setResourceUrl} placeholder={t('library.resourceUrl')} autoCapitalize="none" keyboardType="url" /><Pressable style={styles.secondary} onPress={() => void saveResource()} disabled={busy}><Text style={styles.secondaryText}>{editingResource ? t('library.updateResource') : t('library.addResource')}</Text></Pressable>{resources.slice(0, 30).map((resource) => <View key={resource.id} style={styles.resource}><Pressable onPress={() => resource.url ? void Linking.openURL(resource.url) : undefined}><Text style={styles.bold}>{resource.title}</Text><Text style={styles.muted}>{resource.type || t('library.resources')}{resource.tags?.length ? ' · ' + resource.tags.join(', ') : ''}</Text></Pressable><View style={styles.inline}><Text style={styles.link} onPress={() => { setEditingResource(resource); setResourceTitle(resource.title); setResourceUrl(resource.url ?? ''); }}>{t('common.edit')}</Text><Text style={styles.danger} onPress={() => void (async () => { try { if (isOffline) await queueMutation('RESOURCE_DELETE', { id: resource.id, ...(resource.updatedAt ? { baseUpdatedAt: resource.updatedAt } : {}) }); else await deleteResource(resource.id); setResources((items) => items.filter((item) => item.id !== resource.id)); } catch { setMessage('Could not delete resource.'); } })()}>{t('common.delete')}</Text></View></View>)}</View>
        {selected ? <View style={styles.card}>
            <Text style={styles.heading}>{t('library.reader')} · {selected.title}</Text>
            {totalPages > 0 ? <>
                <View style={styles.pageBar}><Pressable style={styles.readerControl} accessibilityRole="button" disabled={page <= 1} onPress={() => setReaderPage(page - 1)}><Text style={[styles.readerControlText, page <= 1 && styles.disabledText]}>{t('library.previousPage')}</Text></Pressable><Text style={styles.pageLabel}>{t('library.readerPage')} {page} {t('practice.of')} {totalPages}</Text><Pressable style={styles.readerControl} accessibilityRole="button" disabled={page >= totalPages} onPress={() => setReaderPage(page + 1)}><Text style={[styles.readerControlText, page >= totalPages && styles.disabledText]}>{t('library.nextPage')}</Text></Pressable></View>
                <View style={styles.inline}><TextInput style={[styles.input, styles.pageInput]} value={String(page)} onChangeText={(value) => setReaderPage(Number(value.replace(/\D/g, '')) || 1)} keyboardType="number-pad" placeholder={t('library.readerPage')} /><Pressable style={styles.readerMode} accessibilityRole="button" onPress={() => setContinuousReading((value) => !value)}><Text style={styles.readerControlText}>{continuousReading ? t('library.singlePage') : t('library.continuousText')}</Text></Pressable></View>
                <TextInput style={styles.input} value={readerQuery} onChangeText={setReaderQuery} placeholder={t('library.searchInside')} returnKeyType="search" />
                {readerQuery.trim() ? <View style={styles.searchResults}><Text style={styles.muted}>{matchingPages.length ? `${t('library.readerPage')} ${matchingPages.join(', ')}` : t('library.noMatches')}</Text>{matchingPages.slice(0, 12).map((pageNumber) => <Pressable key={pageNumber} accessibilityRole="button" style={styles.searchPage} onPress={() => { setReaderPage(pageNumber); setContinuousReading(false); }}><Text style={styles.readerControlText}>{t('library.goToPage')} {pageNumber}</Text></Pressable>)}</View> : null}
                {continuousReading ? <View style={styles.continuousReader}>{readerPages.length ? readerPages.map((pageText, index) => <Pressable key={index} accessibilityRole="button" style={[styles.textPage, page === index + 1 && styles.textPageActive]} onPress={() => setReaderPage(index + 1)}><Text style={styles.pageLabel}>{t('library.readerPage')} {index + 1}</Text><Text style={styles.readerText}>{pageText || t('library.noReadablePages')}</Text></Pressable>) : <Text style={styles.muted}>{t('library.noExtractedText')}</Text>}</View> : <View style={styles.visualPage}>{pageImageLoading ? <ActivityIndicator color="#2563eb" /> : pageImageUri ? <Image accessibilityLabel={`${t('library.reader')} ${t('library.readerPage')} ${page}`} source={{ uri: pageImageUri }} style={styles.pageImage} resizeMode="contain" /> : currentPage ? <Text style={styles.readerText}>{currentPage}</Text> : <Text style={styles.muted}>{t('library.visualNotCached')}</Text>}</View>}
            </> : <Text style={styles.muted}>{t('library.noReadablePages')}</Text>}
            <Text style={styles.heading}>{t('library.annotations')}</Text><Text style={styles.muted}>{t('library.annotationHint')}</Text><TextInput style={styles.input} value={quote} onChangeText={setQuote} placeholder={t('library.quotePlaceholder')} /><TextInput style={[styles.input, styles.multiline]} value={note} onChangeText={setNote} multiline placeholder={t('library.notePlaceholder')} /><Pressable style={styles.secondary} onPress={() => void saveAnnotation()}><Text style={styles.secondaryText}>{editingAnnotation ? t('library.updateAnnotation') : t('library.saveAnnotation')}</Text></Pressable>{annotations.map((annotation) => <View key={annotation.id} style={styles.annotation}><Text style={styles.body}>{t('library.readerPage')} {annotation.page}: {annotation.note || annotation.quote || t('library.annotations')}</Text><View style={styles.inline}><Text style={styles.link} onPress={() => { setEditingAnnotation(annotation); setReaderPage(annotation.page); setQuote(annotation.quote ?? ''); setNote(annotation.note ?? ''); }}>{t('common.edit')}</Text><Text style={styles.danger} onPress={() => void removeAnnotation(annotation)}>{t('common.delete')}</Text></View></View>)}
        </View> : null}
    </ScrollView></Screen>;
}

const styles = StyleSheet.create({ scroll: { paddingBottom: 32 }, button: { backgroundColor: '#2563eb', borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 10 }, buttonText: { color: '#fff', fontWeight: '700' }, secondary: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 8, marginRight: 8 }, secondaryText: { color: '#2563eb', fontWeight: '700' }, message: { color: '#15803d', marginBottom: 10 }, muted: { color: '#6b7280', lineHeight: 19 }, card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 10 }, selected: { borderColor: '#2563eb' }, heading: { color: '#111827', fontWeight: '800', marginBottom: 5 }, bold: { color: '#111827', fontWeight: '700' }, body: { color: '#374151', lineHeight: 20 }, resource: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 9, marginTop: 9 }, link: { color: '#2563eb', marginTop: 5, marginRight: 14 }, danger: { color: '#b91c1c', marginTop: 5 }, inline: { flexDirection: 'row', alignItems: 'center', gap: 8 }, pageBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, pageLabel: { color: '#374151', fontWeight: '700' }, readerControl: { borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 }, readerMode: { borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 10, marginTop: 8 }, readerControlText: { color: '#1d4ed8', fontWeight: '700', fontSize: 12 }, disabledText: { color: '#9ca3af' }, pageInput: { flex: 1 }, searchResults: { marginTop: 8, padding: 9, backgroundColor: '#f8fafc', borderRadius: 8 }, searchPage: { marginTop: 7, alignSelf: 'flex-start' }, visualPage: { minHeight: 260, backgroundColor: '#f8fafc', borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 14, marginTop: 10 }, continuousReader: { marginTop: 10 }, textPage: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 11, marginBottom: 9, backgroundColor: '#ffffff' }, textPageActive: { borderColor: '#60a5fa', backgroundColor: '#eff6ff' }, pageImage: { width: '100%', height: 520 }, readerText: { color: '#1f2937', lineHeight: 21, marginBottom: 14, marginTop: 6 }, input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, marginTop: 8, color: '#111827' }, multiline: { minHeight: 70, textAlignVertical: 'top' }, annotation: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 8, marginTop: 8 } });
