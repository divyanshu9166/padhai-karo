import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import NativePdf from 'react-native-pdf';

import { ApiError, getAuthToken } from '@/api';
import { API_BASE_URL } from '@/config/env';
import { Screen } from '@/components';
import { interpolate, useTranslation } from '@/localization';
import { cacheJson, readCachedJson } from '@/offline/cache';
import { useOffline } from '@/offline';
import { queueMutation } from '@/offline/mutations';
import { queuePdfUpload } from '@/offline/pendingMedia';
import { createOpenNote, createResource, createRevisionCard, deletePdfAnnotation, deleteResource, getPdfAnnotations, getPdfDocuments, getPdfPageImageUrl, getStudyResources, updateResource, uploadPdfDocument, type AiStudySummary, type PdfAnnotation, type PdfDocument } from '@/api/upscProduct';
import type { MoreStackScreenProps } from '@/navigation/types';

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
function pageImagePath(document: PdfDocument, page: number): string | null {
    if (!FileSystem.documentDirectory) return null;
    const revision = (document.fileChecksum || document.updatedAt || 'unversioned').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'unversioned';
    return `${FileSystem.documentDirectory}padhaikaro-offline/pdf-pages/${document.id}-${revision}-${page}.png`;
}
function pdfSummaryInput(document: PdfDocument, maxCharacters = 18_000): string {
    const pages = pagesOf(document).filter(Boolean);
    if (pages.length === 0) return '';
    const complete = pages.join('\n\n');
    if (complete.length <= maxCharacters) return complete;
    const sampleCount = Math.min(12, pages.length);
    const perPage = Math.floor(maxCharacters / sampleCount) - 40;
    return Array.from({ length: sampleCount }, (_, index) => {
        const pageIndex = sampleCount === 1 ? 0 : Math.round(index * (pages.length - 1) / (sampleCount - 1));
        return `[Page ${pageIndex + 1}]\n${pages[pageIndex].slice(0, perPage)}`;
    }).join('\n\n');
}

export function LibraryScreen({ navigation }: MoreStackScreenProps<'Library'>): React.JSX.Element {
    const t = useTranslation();
    const { isOffline } = useOffline();
    const [documents, setDocuments] = useState<PdfDocument[]>([]);
    const [selected, setSelected] = useState<PdfDocument | null>(null);
    const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
    const [page, setPage] = useState(1);
    const [pageImageUri, setPageImageUri] = useState<string | null>(null);
    const [pageImageLoading, setPageImageLoading] = useState(false);
    const [nativePdfFailed, setNativePdfFailed] = useState(false);
    const [pdfSummary, setPdfSummary] = useState<AiStudySummary | null>(null);
    const [continuousReading, setContinuousReading] = useState(false);
    const [readerQuery, setReaderQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [collection, setCollection] = useState<string | null>(null);
    const [resources, setResources] = useState<StudyResource[]>([]);
    const [resourceTitle, setResourceTitle] = useState('');
    const [resourceUrl, setResourceUrl] = useState('');
    const [resourceTags, setResourceTags] = useState('');
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
                setDocuments((items) => [localDocument, ...items]); setMessage(t('library.queuedUpload')); return;
            }
            const created = await uploadPdfDocument(asset.uri, asset.name, ['library', 'uploaded']);
            setDocuments((items) => [{ ...created.document, localUri: asset.uri }, ...items]);
            setMessage(created.searchable ? t('library.uploadedSearchable') : t('library.uploadedNoText'));
        } catch (error) { setMessage(error instanceof ApiError ? error.message : t('library.addError')); }
        finally { setBusy(false); }
    };

    const selectDocument = async (document: PdfDocument): Promise<void> => {
        setSelected(document); setPage(1); setPageImageUri(null); setNativePdfFailed(false); setPdfSummary(null); setReaderQuery(''); setContinuousReading(false);
        if (document.id.startsWith('offline-')) { setAnnotations((await readCachedJson<PdfAnnotation[]>('pdf-annotations:' + document.id))?.value ?? []); return; }
        try { const next = (await getPdfAnnotations(document.id)).annotations; setAnnotations(next); await cacheJson('pdf-annotations:' + document.id, next); }
        catch { setAnnotations((await readCachedJson<PdfAnnotation[]>('pdf-annotations:' + document.id))?.value ?? []); }
    };

    const downloadPageImage = useCallback(async (document: PdfDocument, pageNumber: number): Promise<string | null> => {
        const target = pageImagePath(document, pageNumber);
        if (!target) return null;
        const directory = FileSystem.documentDirectory;
        if (!directory) return null;
        await FileSystem.makeDirectoryAsync(directory + 'padhaikaro-offline/pdf-pages/', { intermediates: true });
        const existing = await FileSystem.getInfoAsync(target);
        if (existing.exists && (!('size' in existing) || typeof existing.size !== 'number' || existing.size > 0)) return target;
        const partial = target + '.part';
        await FileSystem.deleteAsync(partial, { idempotent: true });
        const result = await FileSystem.downloadAsync(openableUrl(getPdfPageImageUrl(document.id, pageNumber)), partial, { headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}, md5: true });
        if (result.status >= 400) throw new Error(interpolate(t('library.pageRenderFailed'), { status: result.status }));
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
            const local = pageImagePath(document, pageNumber);
            const existing = local ? await FileSystem.getInfoAsync(local) : { exists: false };
            if (existing.exists) { setPageImageUri(local); return; }
            if (isOffline) { setPageImageUri(null); return; }
            setPageImageUri(await downloadPageImage(document, pageNumber));
        } catch { setPageImageUri(null); }
        finally { setPageImageLoading(false); }
    }, [downloadPageImage, isOffline]);

    useEffect(() => {
        if (!selected) return;
        void ensurePageImage(selected, page);
    }, [ensurePageImage, page, selected]);

    const downloadPdfOffline = async (document: PdfDocument): Promise<void> => {
        if (isOffline) { setMessage(t('library.reconnectToDownload')); return; }
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
            if (result.status >= 400) throw new Error(interpolate(t('library.downloadFailed'), { status: result.status }));
            await FileSystem.deleteAsync(target, { idempotent: true });
            await FileSystem.moveAsync({ from: result.uri, to: target });
            let renderedPages = 0;
            if (document.pageCount && document.pageCount > 0) {
                for (let pageNumber = 1; pageNumber <= document.pageCount; pageNumber += 1) {
                    if (await downloadPageImage(document, pageNumber)) renderedPages += 1;
                }
            }
            // `result.uri` is the temporary `.part` path after the atomic move. Keep the
            // final target in the document model, otherwise reopening the library points at
            // a file that no longer exists and the PDF appears to have vanished offline.
            const updated = { ...document, localUri: target };
            setDocuments((items) => items.map((item) => item.id === document.id ? updated : item));
            if (selected?.id === document.id) setSelected(updated);
            await cacheJson('library-offline-pdfs', [updated, ...(await readCachedJson<PdfDocument[]>('library-offline-pdfs'))?.value?.filter((item) => item.id !== document.id) ?? []]);
            setPageImageUri(pageImagePath(document, page) ?? null);
            setMessage(renderedPages > 0 ? interpolate(t('library.savedOfflineWithPages'), { count: renderedPages }) : t('library.savedOffline'));
        } catch (error) { setMessage(error instanceof Error ? error.message : t('library.saveOfflineError')); }
        finally { setBusy(false); }
    };

    const summarizePdf = async (): Promise<void> => {
        if (!selected) return;
        const text = pdfSummaryInput(selected);
        if (isOffline) { setMessage(t('library.connectForSummary')); return; }
        setBusy(true); setMessage(null);
        try {
            let result: Awaited<ReturnType<typeof createOpenNote>>;
            if (text) {
                result = await createOpenNote({ inputType: 'TEXT', text, title: selected.title });
            } else {
                if (selected.id.startsWith('offline-')) throw new Error(t('library.uploadBeforeVision'));
                const imageUri = await downloadPageImage(selected, page);
                if (!imageUri) throw new Error(t('library.renderForVisionError'));
                const imageData = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
                result = await createOpenNote({ inputType: 'PHOTO', imageData, mimeType: 'image/png', title: `${selected.title} · ${interpolate(t('library.pageN'), { page })}` });
            }
            setPdfSummary(result.summary.summary);
            setMessage(`${text ? t('library.pdfSummaryCreated') : interpolate(t('library.pageSummaryCreated'), { page })} ${interpolate(t('library.aiNotesLeft'), { count: result.remainingQuota })}`);
        } catch (error) { setMessage(error instanceof ApiError || error instanceof Error ? error.message : t('library.summarizeError')); }
        finally { setBusy(false); }
    };

    const removeAnnotation = async (annotation: PdfAnnotation): Promise<void> => {
        if (!selected) return;
        try { if (!selected.id.startsWith('offline-')) await deletePdfAnnotation(annotation.id, annotation.updatedAt); const next = annotations.filter((item) => item.id !== annotation.id); setAnnotations(next); await cacheJson('pdf-annotations:' + selected.id, next); setMessage(t('library.annotationDeleted')); }
        catch (error) { setMessage(error instanceof ApiError ? error.message : t('library.annotationDeleteError')); }
    };

    const addAnnotationToRevision = async (annotation: PdfAnnotation): Promise<void> => {
        if (!selected) return;
        const excerpt = (annotation.quote || annotation.note || '').trim();
        if (!excerpt) { setMessage(t('library.needNoteForRevision')); return; }
        setBusy(true);
        try {
            await createRevisionCard({
                title: `${selected.title} · ${interpolate(t('library.pageN'), { page: annotation.page })}`,
                prompt: annotation.quote?.trim() || interpolate(t('library.recallKeyIdea'), { title: selected.title, page: annotation.page }),
                answer: annotation.note?.trim() || excerpt,
                tags: ['library', 'pdf', ...selected.tags.slice(0, 3)],
            });
            setMessage(t('library.annotationToRevision'));
        } catch (error) { setMessage(error instanceof ApiError ? error.message : t('library.annotationToRevisionError')); }
        finally { setBusy(false); }
    };

    const saveResource = async (): Promise<void> => {
        if (!resourceTitle.trim()) return;
        const input = { title: resourceTitle.trim(), url: resourceUrl.trim() || undefined, type: 'LINK', tags: Array.from(new Set(['library', ...resourceTags.split(',').map((tag) => tag.trim()).filter(Boolean)])) };
        setBusy(true); setMessage(null);
        try {
            if (editingResource) {
                if (isOffline) await queueMutation('RESOURCE_UPDATE', { id: editingResource.id, ...input, ...(editingResource.updatedAt ? { baseUpdatedAt: editingResource.updatedAt } : {}) }); else await updateResource(editingResource.id, input);
                setResources((items) => items.map((item) => item.id === editingResource.id ? { ...item, ...input } : item)); setMessage(isOffline ? t('library.resourceEditQueued') : t('library.resourceUpdated'));
            } else if (isOffline) {
                const localId = 'offline-resource-' + Date.now();
                await queueMutation('RESOURCE_CREATE', { id: localId, title: input.title, url: input.url, resourceType: input.type, tags: input.tags });
                setResources((items) => [{ id: localId, ...input }, ...items]); setMessage(t('library.resourceSavedOffline'));
            } else { const created = await createResource(input); setResources((items) => [created.resource as StudyResource, ...items]); setMessage(t('library.resourceSaved')); }
            setEditingResource(null); setResourceTitle(''); setResourceUrl(''); setResourceTags('');
        } catch (error) { setMessage(error instanceof ApiError ? error.message : t('library.resourceSaveError')); }
        finally { setBusy(false); }
    };

    const readerPages = useMemo(() => selected ? pagesOf(selected) : [], [selected]);
    const currentPage = readerPages[page - 1] ?? '';
    const totalPages = selected?.pageCount ?? readerPages.length;
    const nativePdfSource = useMemo(() => {
        const uri = selected?.localUri ?? (selected?.fileUrl ? openableUrl(selected.fileUrl) : null);
        if (!uri) return null;
        const token = getAuthToken();
        return { uri, cache: true, ...(token && !selected?.localUri ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
    }, [selected]);
    const matchingPages = useMemo(() => {
        const needle = readerQuery.trim().toLocaleLowerCase();
        if (!needle) return [];
        return readerPages.flatMap((pageText, index) => pageText.toLocaleLowerCase().includes(needle) ? [index + 1] : []);
    }, [readerPages, readerQuery]);
    const collections = useMemo(() => Array.from(new Set([...documents.flatMap((document) => document.tags), ...resources.flatMap((resource) => resource.tags ?? [])]))
        .filter((tag) => !['library', 'uploaded', 'offline-pending'].includes(tag.toLowerCase())).sort(), [documents, resources]);
    const collectionDocuments = useMemo(() => collection ? documents.filter((document) => document.tags.includes(collection)) : documents, [collection, documents]);
    const collectionResources = useMemo(() => collection ? resources.filter((resource) => resource.tags?.includes(collection)) : resources, [collection, resources]);
    const setReaderPage = (nextPage: number): void => {
        if (totalPages <= 0) return;
        setPage(Math.max(1, Math.min(totalPages, Math.floor(nextPage))));
    };

    return <Screen title={t('library.title')}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInput style={styles.input} value={query} onChangeText={setQuery} onSubmitEditing={() => void load(query)} placeholder={t('library.searchPlaceholder')} returnKeyType="search" />
        <Pressable style={styles.button} onPress={() => void pickPdf()} disabled={busy}><Text style={styles.buttonText}>{busy ? t('common.working') : t('library.addPdf')}</Text></Pressable>
        <Pressable style={styles.secondary} onPress={() => navigation.navigate('ConceptMapBuilder')}><Text style={styles.secondaryText}>{t('library.buildConceptMap')}</Text></Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {collections.length > 0 ? <View style={styles.collections}><Text style={styles.collectionLabel}>{t('library.collections')}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.collectionRow}><Pressable style={[styles.collectionChip, !collection && styles.collectionChipActive]} onPress={() => setCollection(null)}><Text style={[styles.collectionText, !collection && styles.collectionTextActive]}>{t('library.all')}</Text></Pressable>{collections.map((tag) => <Pressable key={tag} style={[styles.collectionChip, collection === tag && styles.collectionChipActive]} onPress={() => setCollection(tag)}><Text style={[styles.collectionText, collection === tag && styles.collectionTextActive]}>{tag}</Text></Pressable>)}</ScrollView></View> : null}
        {collectionDocuments.length === 0 ? <Text style={styles.muted}>{collection ? interpolate(t('library.noPdfsIn'), { collection }) : t('library.empty')}</Text> : collectionDocuments.map((document) => <Pressable key={document.id} style={[styles.card, selected?.id === document.id && styles.selected]} onPress={() => void selectDocument(document)}><Text style={styles.heading}>{document.title}</Text><Text style={styles.muted}>{document.pageCount ? document.pageCount + ' ' + t('common.pages') : t('library.pdfDocument')} · {document.tags.join(', ')}</Text>{document.fileUrl || document.localUri ? <Text style={styles.link} onPress={() => void Linking.openURL(openableUrl(document.localUri ?? document.fileUrl ?? ''))}>{t('library.openFile')}</Text> : null}{document.fileUrl && !document.localUri && !isOffline ? <Text style={styles.link} onPress={() => void downloadPdfOffline(document)}>{t('common.saveOffline')}</Text> : null}</Pressable>)}
        <View style={styles.card}><Text style={styles.heading}>{t('library.resources')}</Text><TextInput style={styles.input} value={resourceTitle} onChangeText={setResourceTitle} placeholder={t('library.resourceTitle')} /><TextInput style={styles.input} value={resourceUrl} onChangeText={setResourceUrl} placeholder={t('library.resourceUrl')} autoCapitalize="none" keyboardType="url" /><TextInput style={styles.input} value={resourceTags} onChangeText={setResourceTags} placeholder={t('library.collectionsPlaceholder')} /><Pressable style={styles.secondary} onPress={() => void saveResource()} disabled={busy}><Text style={styles.secondaryText}>{editingResource ? t('library.updateResource') : t('library.addResource')}</Text></Pressable>{collectionResources.slice(0, 30).map((resource) => <View key={resource.id} style={styles.resource}><Pressable onPress={() => resource.url ? void Linking.openURL(resource.url) : undefined}><Text style={styles.bold}>{resource.title}</Text><Text style={styles.muted}>{resource.type || t('library.resources')}{resource.tags?.length ? ' · ' + resource.tags.join(', ') : ''}</Text></Pressable><View style={styles.inline}><Text style={styles.link} onPress={() => { setEditingResource(resource); setResourceTitle(resource.title); setResourceUrl(resource.url ?? ''); setResourceTags((resource.tags ?? []).filter((tag) => tag !== 'library').join(', ')); }}>{t('common.edit')}</Text><Text style={styles.danger} onPress={() => void (async () => { try { if (isOffline) await queueMutation('RESOURCE_DELETE', { id: resource.id, ...(resource.updatedAt ? { baseUpdatedAt: resource.updatedAt } : {}) }); else await deleteResource(resource.id); setResources((items) => items.filter((item) => item.id !== resource.id)); } catch { setMessage(t('library.resourceDeleteError')); } })()}>{t('common.delete')}</Text></View></View>)}</View>
        {selected ? <View style={styles.card}>
            <Text style={styles.heading}>{t('library.reader')} · {selected.title}</Text>
            <Pressable style={styles.button} disabled={busy || isOffline || (pdfSummaryInput(selected).length === 0 && selected.id.startsWith('offline-'))} onPress={() => void summarizePdf()}><Text style={styles.buttonText}>{busy ? t('common.working') : pdfSummaryInput(selected).length > 0 ? t('library.summarizePdf') : interpolate(t('library.summarizePageVision'), { page })}</Text></Pressable>
            {pdfSummary ? <View style={styles.summaryPanel}><Text style={styles.heading}>{pdfSummary.title || selected.title}</Text>{pdfSummary.keyPoints.map((point, index) => <Text key={`${index}-${point}`} style={styles.body}>• {point}</Text>)}</View> : null}
            {totalPages > 0 ? <>
                <View style={styles.pageBar}><Pressable style={styles.readerControl} accessibilityRole="button" disabled={page <= 1} onPress={() => setReaderPage(page - 1)}><Text style={[styles.readerControlText, page <= 1 && styles.disabledText]}>{t('library.previousPage')}</Text></Pressable><Text style={styles.pageLabel}>{t('library.readerPage')} {page} {t('practice.of')} {totalPages}</Text><Pressable style={styles.readerControl} accessibilityRole="button" disabled={page >= totalPages} onPress={() => setReaderPage(page + 1)}><Text style={[styles.readerControlText, page >= totalPages && styles.disabledText]}>{t('library.nextPage')}</Text></Pressable></View>
                <View style={styles.inline}><TextInput style={[styles.input, styles.pageInput]} value={String(page)} onChangeText={(value) => setReaderPage(Number(value.replace(/\D/g, '')) || 1)} keyboardType="number-pad" placeholder={t('library.readerPage')} /><Pressable style={styles.readerMode} accessibilityRole="button" onPress={() => setContinuousReading((value) => !value)}><Text style={styles.readerControlText}>{continuousReading ? t('library.singlePage') : t('library.continuousText')}</Text></Pressable></View>
                <TextInput style={styles.input} value={readerQuery} onChangeText={setReaderQuery} placeholder={t('library.searchInside')} returnKeyType="search" />
                {readerQuery.trim() ? <View style={styles.searchResults}><Text style={styles.muted}>{matchingPages.length ? `${t('library.readerPage')} ${matchingPages.join(', ')}` : t('library.noMatches')}</Text>{matchingPages.slice(0, 12).map((pageNumber) => <Pressable key={pageNumber} accessibilityRole="button" style={styles.searchPage} onPress={() => { setReaderPage(pageNumber); setContinuousReading(false); }}><Text style={styles.readerControlText}>{t('library.goToPage')} {pageNumber}</Text></Pressable>)}</View> : null}
                {continuousReading ? <View style={styles.continuousReader}>{readerPages.length ? readerPages.map((pageText, index) => <Pressable key={index} accessibilityRole="button" style={[styles.textPage, page === index + 1 && styles.textPageActive]} onPress={() => setReaderPage(index + 1)}><Text style={styles.pageLabel}>{t('library.readerPage')} {index + 1}</Text><Text style={styles.readerText}>{pageText || t('library.noReadablePages')}</Text></Pressable>) : <Text style={styles.muted}>{t('library.noExtractedText')}</Text>}</View> : nativePdfSource && !nativePdfFailed ? <View style={styles.nativePdfFrame}><NativePdf source={nativePdfSource} page={page} horizontal enablePaging spacing={8} trustAllCerts={false} onPageChanged={(nextPage) => setPage(nextPage)} onLoadComplete={(pages) => { if (!selected.pageCount && pages > 0) setSelected((current) => current ? { ...current, pageCount: pages } : current); }} onError={() => setNativePdfFailed(true)} style={styles.nativePdf} /></View> : <View style={styles.visualPage}>{pageImageLoading ? <ActivityIndicator color="#2563eb" /> : pageImageUri ? <Image accessibilityLabel={`${t('library.reader')} ${t('library.readerPage')} ${page}`} source={{ uri: pageImageUri }} style={styles.pageImage} resizeMode="contain" /> : currentPage ? <Text style={styles.readerText}>{currentPage}</Text> : <Text style={styles.muted}>{t('library.visualNotCached')}</Text>}</View>}
            </> : <Text style={styles.muted}>{t('library.noReadablePages')}</Text>}
            <Text style={styles.heading}>{t('library.annotations')}</Text><Text style={styles.muted}>{t('library.annotationHint')}</Text><Pressable style={styles.secondary} onPress={() => navigation.navigate('PdfAnnotationEditor', { documentId: selected.id, documentTitle: selected.title, page, pageText: currentPage })}><Text style={styles.secondaryText}>{t('library.openEditor')}</Text></Pressable>{annotations.map((annotation) => <View key={annotation.id} style={styles.annotation}><Text style={styles.body}>{t('library.readerPage')} {annotation.page}: {annotation.note || annotation.quote || t('library.annotations')}</Text><View style={styles.inline}><Text style={styles.link} onPress={() => navigation.navigate('PdfAnnotationEditor', { documentId: selected.id, documentTitle: selected.title, page: annotation.page, pageText: readerPages[annotation.page - 1] ?? '', annotationId: annotation.id, quote: annotation.quote ?? undefined, note: annotation.note ?? undefined, color: annotation.color, updatedAt: annotation.updatedAt })}>{t('common.edit')}</Text><Text style={styles.link} onPress={() => void addAnnotationToRevision(annotation)}>{t('library.saveForRecall')}</Text><Text style={styles.danger} onPress={() => void removeAnnotation(annotation)}>{t('common.delete')}</Text></View></View>)}
        </View> : null}
    </ScrollView></Screen>;
}

const styles = StyleSheet.create({ scroll: { paddingBottom: 32 }, button: { backgroundColor: '#2563eb', borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 10 }, buttonText: { color: '#fff', fontWeight: '700' }, secondary: { borderWidth: 1, borderColor: '#2563eb', borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 8, marginRight: 8 }, secondaryText: { color: '#2563eb', fontWeight: '700' }, message: { color: '#15803d', marginBottom: 10 }, muted: { color: '#6b7280', lineHeight: 19 }, card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 14, marginBottom: 10 }, selected: { borderColor: '#2563eb' }, heading: { color: '#111827', fontWeight: '800', marginBottom: 5 }, bold: { color: '#111827', fontWeight: '700' }, body: { color: '#374151', lineHeight: 20 }, summaryPanel: { backgroundColor: '#eff6ff', borderRadius: 10, padding: 12, marginBottom: 12 }, collections: { marginBottom: 12 }, collectionLabel: { color: '#475569', fontSize: 12, fontWeight: '800', marginBottom: 7 }, collectionRow: { paddingRight: 16 }, collectionChip: { borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 11, marginRight: 7, backgroundColor: '#fff' }, collectionChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' }, collectionText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' }, collectionTextActive: { color: '#fff' }, resource: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 9, marginTop: 9 }, link: { color: '#2563eb', marginTop: 5, marginRight: 14 }, danger: { color: '#b91c1c', marginTop: 5 }, inline: { flexDirection: 'row', alignItems: 'center', gap: 8 }, pageBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, pageLabel: { color: '#374151', fontWeight: '700' }, readerControl: { borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7 }, readerMode: { borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 10, marginTop: 8 }, readerControlText: { color: '#1d4ed8', fontWeight: '700', fontSize: 12 }, disabledText: { color: '#9ca3af' }, pageInput: { flex: 1 }, searchResults: { marginTop: 8, padding: 9, backgroundColor: '#f8fafc', borderRadius: 8 }, searchPage: { marginTop: 7, alignSelf: 'flex-start' }, nativePdfFrame: { height: 520, backgroundColor: '#e5e7eb', borderRadius: 10, overflow: 'hidden', marginBottom: 14, marginTop: 10 }, nativePdf: { flex: 1, width: '100%', backgroundColor: '#e5e7eb' }, visualPage: { minHeight: 260, backgroundColor: '#f8fafc', borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 14, marginTop: 10 }, continuousReader: { marginTop: 10 }, textPage: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, padding: 11, marginBottom: 9, backgroundColor: '#ffffff' }, textPageActive: { borderColor: '#60a5fa', backgroundColor: '#eff6ff' }, pageImage: { width: '100%', height: 520 }, readerText: { color: '#1f2937', lineHeight: 21, marginBottom: 14, marginTop: 6 }, input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 10, marginTop: 8, color: '#111827' }, multiline: { minHeight: 70, textAlignVertical: 'top' }, annotation: { borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 8, marginTop: 8 } });
