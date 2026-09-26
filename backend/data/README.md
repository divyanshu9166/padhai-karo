# Official PYQ data workflow

The app does not ship a guessed or third-party question bank. Every question comes from an
official question paper and is checked against the official **final** answer key by a person
before it reaches students.

```
pyq:prepare  →  pyq:extract  →  review.html (a person)  →  pyq:finalize  →  pyq:import
 download        OCR + key       fix + approve              validate         database
```

## 1. Download — `npm run pyq:prepare`

Downloads the papers and answer keys listed in `official-pyq-sources.json` (HTTPS, only from
`upsc.gov.in` / `ssc.gov.in`) into `official-pyq-downloads/` and writes a SHA-256 receipt for
each. Each manifest entry needs `id`, `program`, `stage`, `year`, `paperKey` (a paper key from
`src/lib/exams`, e.g. `UPSC-CSE-PRELIMS-GS1-2024`), `downloadUrl`, `answerKeyUrl`, and:

- `series` — the booklet series printed in the big box on the paper's **cover page** (every
  UPSC paper from 2017–2024 here is series **A**); its page in the answer-key PDF is used.
  Always check the cover yourself: the extractor cross-checks page footers, but older scans'
  footers are often unreadable, and a wrong series pairs every question with another booklet's key.
- `subjectId` — optional; defaults to `UPSC-CSE-GS1` / `UPSC-CSE-CSAT` for Prelims papers.
- `keyPage` — optional 1-based answer-key page, only if the series box cannot be read (verify
  it on the scan). Without it, a key PDF of four pages whose readable boxes follow A–D order
  is resolved by position, with a warning.

## 2. Extract a draft — `npm run pyq:extract -- <id>`

Runs locally on Windows with no network and no paid API (about 20 seconds per paper):

1. Checks both PDFs still match their receipts.
2. Renders every page with Poppler (`PDF_RENDERER_BIN`).
3. Reads the English pages with the built-in Windows OCR engine (`scripts/pyq/ocr-windows.ps1`),
   rebuilds the two-column reading order, and parses numbered questions with four options.
   Options the first pass missed are re-read from enlarged crops (`scripts/pyq/crop-regions.ps1`).
4. Finds the series page in the answer key, recovers the key grid from the question numbers
   (any row count, with or without "Q. No. / Key" headers, tilted scans), and reads every key cell by template matching
   against letters cut from the same scan (`scripts/pyq/classify-cells.ps1`). Only confident
   readings are filled in; `X` (dropped by UPSC) is recorded; everything else goes to review.

Output: `official-pyq-drafts/<id>.draft.json` and a review page at
`official-pyq-work/<id>/review.html` (the work folder holds page images and is git-ignored;
re-run extraction to recreate it).

Measured on the 2024 papers: GS Paper I — 100/100 questions and options found, 81 key cells read
automatically with **no wrong reading**, 17 sent to review. CSAT — 80/80 questions, 66 with all
four options (short side-by-side maths options are the weak spot), 76 key cells automatic.

## 3. Review — open `review.html`

Open the file in any browser. Each question shows the matching crop of the scan next to the
extracted text; the answer shows the crop of the official key cell. Flagged questions come first
(missing options, tables, maths symbols, passages, numbers the OCR slipped on). For **every**
question: fix the text so it matches the printed paper exactly, confirm the answer from the key
cell (never from memory or a coaching key), and tick **Approved**. Progress is saved in the
browser. When done, click **Download reviewed draft**.

## 4. Finalize — `npm run pyq:finalize -- <downloaded>.reviewed.json`

Refuses the file unless every question is approved, has four non-empty options and a final
answer (or is a confirmed UPSC drop), and the source PDFs are unchanged since extraction.
Writes the import file to `official-pyq-reviewed/<id>.json`.

## 5. Import — `OFFICIAL_PYQ_FILE=official-pyq-reviewed/<id>.json npm run pyq:import`

Validates again and writes the paper, answer key and questions in one transaction. Re-importing
the same `paperKey` replaces it. Dropped questions are stored as a count on the paper, so the
full mock treats a 97-question paper with 3 drops as complete and spreads the maximum marks
over the scored questions, the way UPSC does. Check `GET /api/admin/pyq/status` afterwards.

`official-pyq-reviewed/upsc-cse-prelims-2024-gs1-reviewed-starter.json` is a small five-question
batch for smoke tests; the full mock prefers a complete paper over it automatically.

SSC CGL question papers and final keys are released through the candidate login flow; the
app does not bypass that login or manufacture answers.
