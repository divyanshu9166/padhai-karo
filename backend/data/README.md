# Official PYQ data workflow

The app intentionally does not ship a guessed or third-party question bank. Use the official
source manifest and the operator workflow below before enabling a paper in production:

1. Run `npm run pyq:prepare` to download only HTTPS documents from the allow-listed UPSC/SSC
   domains and write immutable SHA-256 receipts under `data/official-pyq-downloads/`.
2. A reviewer transcribes the question text/options and final answer key into a JSON file matching
   `official-pyq.example.json`. The answer key must be checked against the final official key,
   not a coaching answer key.
3. Set `OFFICIAL_PYQ_FILE` and run `npm run pyq:import`. The importer validates the program,
   stage, subject track, four options, answer-key coverage and official source URL in one
   transaction. Re-running the same `paperKey` is idempotent.
4. Check `GET /api/admin/pyq/status` with the operator key. A paper is mock-eligible only after
   this import succeeds and its questions are present.

`official-pyq-reviewed/upsc-cse-prelims-2024-gs1-reviewed-starter.json` is a deliberately small,
five-question reviewed starter batch. It is safe for smoke-testing the mock flow, but it is not a
claim that the complete 2024 paper has been transcribed. Import it only after applying the latest
Prisma migration; `npm run prisma:seed` also materializes this starter batch on a fresh database.
Replace/add reviewed JSON batches as the remaining questions are checked.

The manifest includes the official UPSC 2024 question-paper URLs and the official SSC CGL page.
SSC's final-key/candidate-download flow must be completed by an authorized operator; the app does
not bypass that login or manufacture answers.
