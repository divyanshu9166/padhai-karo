-- Preserve the canonical sequence from reviewed official papers. Existing legacy rows have
-- no source order, so they keep 0 and use their stable id as the deterministic fallback.
ALTER TABLE "PYQ" ADD COLUMN "questionNumber" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "PYQ_paperId_questionNumber_idx" ON "PYQ"("paperId", "questionNumber");
