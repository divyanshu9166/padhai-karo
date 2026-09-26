/**
 * A self-contained review page for a PYQ draft. It opens straight from disk (no server):
 * every question shows the matching crop of the scanned page next to editable text, the
 * answer shows the crop of the official key cell, progress is kept in localStorage, and the
 * reviewer downloads the reviewed draft for `npm run pyq:finalize`.
 */
import type { PyqDraft } from './draft';

const ISSUE_HELP: Record<string, string> = {
    OPTIONS_INCOMPLETE: 'Fewer than four options were read. Type the missing option(s) from the scan.',
    STEM_SHORT: 'The question text looks too short. Check it against the scan.',
    MAY_HAVE_FIGURE: 'Mentions a figure/diagram/graph. If the question needs an image, note it and do not approve.',
    MAY_HAVE_TABLE: 'Contains a table or matching list. OCR flattens tables; rewrite it row by row.',
    OCR_NOISE: 'Unusual characters found. Look for misread words or symbols (₹, °, fractions).',
    PASSAGE_ATTACHMENT_UNVERIFIED: 'A passage was attached automatically. Confirm it belongs to this question.',
    NUMBER_SKIPPED_BEFORE: 'The previous question number was not found. Check nothing is merged into this one.',
    NUMBER_OCR_CORRECTED: 'The printed number was misread and corrected from the sequence. Confirm it.',
    NUMBER_NOT_READ: 'The number was not read; the question was split by layout. Confirm the boundaries.',
    LIST_ITEM_MISSING: 'The options mention a numbered statement that is missing from the text.',
    NOT_FOUND_IN_SCAN: 'Not found automatically. Transcribe the question and options from the scan.',
};

export function renderReviewPage(draft: PyqDraft): string {
    // Embedded as data; "<" is escaped so paper text can never close the script element.
    const data = JSON.stringify({ draft, help: ISSUE_HELP }).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review ${draft.paperKey}</title>
<style>
  :root { color-scheme: light; font-family: system-ui, "Segoe UI", sans-serif; }
  body { margin: 0; background: #f1f5f9; color: #0f172a; }
  header { position: sticky; top: 0; z-index: 2; background: #0f172a; color: #fff; padding: 12px 20px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  header h1 { font-size: 17px; margin: 0 12px 0 0; }
  header .progress { font-weight: 700; }
  header select, header button { font: inherit; padding: 6px 10px; border-radius: 6px; border: 0; }
  header button.primary { background: #f97316; color: #fff; font-weight: 700; cursor: pointer; }
  main { max-width: 1500px; margin: 0 auto; padding: 16px; }
  .guide { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; line-height: 1.5; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; padding: 16px; }
  .card.approved { border-color: #22c55e; box-shadow: inset 4px 0 0 #22c55e; }
  .card.attention { box-shadow: inset 4px 0 0 #f97316; }
  .scan canvas { max-width: 100%; border: 1px solid #cbd5e1; border-radius: 6px; display: block; margin-bottom: 8px; background: #fff; }
  .scan .none { color: #b91c1c; }
  h2 { margin: 0 0 8px; font-size: 16px; }
  label { display: block; font-size: 12px; font-weight: 700; color: #475569; margin: 10px 0 4px; }
  textarea, input[type=text], select.answer { width: 100%; box-sizing: border-box; font: 15px/1.45 system-ui, sans-serif; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
  textarea { min-height: 120px; resize: vertical; }
  .opt { display: grid; grid-template-columns: 34px 1fr; align-items: center; gap: 6px; margin-bottom: 6px; }
  .opt b { text-align: center; }
  .issues span { display: inline-block; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 2px 10px; font-size: 12px; margin: 0 6px 6px 0; }
  .issues p { margin: 2px 0 8px; font-size: 13px; color: #92400e; }
  .answer-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .answer-row canvas { border: 1px solid #cbd5e1; border-radius: 6px; }
  .status { font-size: 13px; font-weight: 700; }
  .status.auto { color: #15803d; } .status.review { color: #c2410c; } .status.dropped { color: #6b21a8; }
  .approve { margin-top: 12px; display: flex; gap: 8px; align-items: center; font-weight: 700; }
  .approve input { width: 20px; height: 20px; }
  @media (max-width: 1000px) { .card { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>${draft.paperKey} · Series ${draft.series}</h1>
  <span class="progress" id="progress"></span>
  <select id="filter">
    <option value="attention">Needs attention first</option>
    <option value="pending">Not yet approved</option>
    <option value="all">All questions</option>
  </select>
  <button class="primary" id="download">Download reviewed draft</button>
</header>
<main>
  <div class="guide">
    <b>How to review.</b> For every question, compare the text and all four options with the scan on the left and fix any OCR slip
    (missing words, ₹/° symbols, statement numbers, table rows). Confirm the answer against the official key cell shown under it —
    never from memory or a coaching key. Tick <b>Approved</b> only when the question is exactly as printed.
    Your work is saved in this browser automatically; click <b>Download reviewed draft</b> when all ${draft.expectedQuestions} are approved
    (or to take a backup), then run <code>npm run pyq:finalize -- &lt;downloaded file&gt;</code>.
  </div>
  <div id="cards"></div>
</main>
<script id="data" type="application/json">${data}</script>
<script>
(function () {
  const { draft, help } = JSON.parse(document.getElementById('data').textContent);
  const storageKey = 'pyq-review:' + draft.sourceId + ':' + draft.extractedAt;
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved && Array.isArray(saved.questions) && saved.questions.length === draft.questions.length) draft.questions = saved.questions;
  const save = () => { localStorage.setItem(storageKey, JSON.stringify({ questions: draft.questions })); updateProgress(); };
  const images = new Map();
  const loadImage = (src) => {
    if (!images.has(src)) images.set(src, new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; }));
    return images.get(src);
  };
  const crop = (canvas, src, box, scale) => {
    const pad = 12;
    const sx = Math.max(0, box.x - pad), sy = Math.max(0, box.y - pad), sw = box.w + pad * 2, sh = box.h + pad * 2;
    canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
    loadImage(src).then((img) => canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)).catch(() => { canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'none', textContent: 'Could not load ' + src })); });
  };
  const needsAttention = (q) => q.issues.length > 0 || q.answerStatus !== 'AUTO';
  const el = (tag, props, children) => { const node = Object.assign(document.createElement(tag), props || {}); (children || []).forEach((c) => node.append(c)); return node; };

  function card(q) {
    const root = el('section', { className: 'card' });
    const refresh = () => { root.classList.toggle('approved', q.reviewStatus === 'APPROVED'); root.classList.toggle('attention', q.reviewStatus !== 'APPROVED' && needsAttention(q)); };
    const scan = el('div', { className: 'scan' }, [el('h2', { textContent: 'Scan · Q' + q.questionRef })]);
    if (q.regions.length === 0) scan.append(el('p', { className: 'none', textContent: 'No region found — use the page images in the pages/ folder.' }));
    q.regions.forEach((r) => { const c = el('canvas'); crop(c, draft.pageImages[r.page], r, 0.75); scan.append(c); });

    const form = el('div');
    form.append(el('h2', { textContent: 'Question ' + q.questionRef }));
    if (q.issues.length) {
      const box = el('div', { className: 'issues' });
      q.issues.forEach((i) => { box.append(el('span', { textContent: i })); box.append(el('p', { textContent: help[i] || '' })); });
      form.append(box);
    }
    const onEdit = () => { if (q.reviewStatus === 'APPROVED') { q.reviewStatus = 'PENDING'; approve.checked = false; refresh(); } save(); };
    if (q.preamble !== undefined) {
      form.append(el('label', { textContent: 'Passage / directions (shown above the question)' }));
      form.append(el('textarea', { value: q.preamble, oninput: (e) => { q.preamble = e.target.value; onEdit(); } }));
    }
    form.append(el('label', { textContent: 'Question text' }));
    form.append(el('textarea', { value: q.questionText, oninput: (e) => { q.questionText = e.target.value; onEdit(); } }));
    form.append(el('label', { textContent: 'Options' }));
    ['a', 'b', 'c', 'd'].forEach((letter, i) => form.append(el('div', { className: 'opt' }, [el('b', { textContent: '(' + letter + ')' }), el('input', { type: 'text', value: q.options[i] || '', oninput: (e) => { q.options[i] = e.target.value; onEdit(); } })])));

    form.append(el('label', { textContent: 'Official answer' }));
    const status = el('span', { className: 'status' });
    const setStatus = () => {
      status.className = 'status ' + (q.answerStatus === 'AUTO' ? 'auto' : q.answerStatus === 'DROPPED' ? 'dropped' : 'review');
      status.textContent = q.answerStatus === 'AUTO' ? 'Read automatically — confirm with the key cell'
        : q.answerStatus === 'DROPPED' ? 'Dropped by UPSC (not scored)'
        : 'Needs your reading' + (q.answerGuess ? ' (machine guess: ' + q.answerGuess + ')' : '');
    };
    const select = el('select', { className: 'answer' });
    [['', '— choose —'], ['0', 'A'], ['1', 'B'], ['2', 'C'], ['3', 'D'], ['X', 'X — dropped by UPSC']].forEach(([value, text]) => select.append(el('option', { value, textContent: text })));
    select.value = q.answerStatus === 'DROPPED' ? 'X' : q.answer === null ? '' : String(q.answer);
    select.onchange = () => {
      if (select.value === 'X') { q.answer = null; q.answerStatus = 'DROPPED'; }
      else if (select.value === '') { q.answer = null; q.answerStatus = 'NEEDS_REVIEW'; }
      else { q.answer = Number(select.value); q.answerStatus = 'AUTO'; q.answerGuess = undefined; }
      setStatus(); onEdit();
    };
    const row = el('div', { className: 'answer-row' }, [select]);
    if (q.keyCell) { const c = el('canvas'); crop(c, draft.keyImage, q.keyCell, 1.5); row.append(c); }
    row.append(status);
    form.append(row);
    setStatus();

    form.append(el('label', { textContent: 'Reviewer note (optional)' }));
    form.append(el('input', { type: 'text', value: q.reviewerNote || '', oninput: (e) => { q.reviewerNote = e.target.value; save(); } }));
    const approve = el('input', { type: 'checkbox', checked: q.reviewStatus === 'APPROVED' });
    approve.onchange = () => { q.reviewStatus = approve.checked ? 'APPROVED' : 'PENDING'; refresh(); save(); };
    form.append(el('label', { className: 'approve' }, [approve, 'Approved — matches the printed paper and the official key']));
    root.append(scan, form);
    refresh();
    return root;
  }

  const cardsEl = document.getElementById('cards');
  const filterEl = document.getElementById('filter');
  function render() {
    cardsEl.textContent = '';
    let list = draft.questions.slice();
    if (filterEl.value === 'pending') list = list.filter((q) => q.reviewStatus !== 'APPROVED');
    if (filterEl.value === 'attention') list.sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
    list.forEach((q) => cardsEl.append(card(q)));
  }
  function updateProgress() {
    const done = draft.questions.filter((q) => q.reviewStatus === 'APPROVED').length;
    document.getElementById('progress').textContent = done + ' / ' + draft.questions.length + ' approved';
  }
  filterEl.onchange = render;
  document.getElementById('download').onclick = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: draft.sourceId + '.reviewed.json' });
    document.body.append(a); a.click(); a.remove();
  };
  render(); updateProgress();
})();
</script>
</body>
</html>
`;
}
