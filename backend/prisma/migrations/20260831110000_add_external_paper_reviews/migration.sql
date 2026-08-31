-- Structured, user-owned analysis for papers attempted outside the app.
-- This is intentionally separate from the official PYQ corpus: scores are self-reported and
-- are used only to create an actionable study review, never an exam outcome claim.
CREATE TABLE "ExternalPaperReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceName" TEXT,
    "testDate" TIMESTAMP(3) NOT NULL,
    "obtainedScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "mistakeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selfNotes" TEXT,
    "documentId" TEXT,
    "externalMockScoreId" TEXT,
    "analysis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPaperReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalPaperReview_externalMockScoreId_key"
ON "ExternalPaperReview"("externalMockScoreId");

CREATE INDEX "ExternalPaperReview_userId_testDate_idx"
ON "ExternalPaperReview"("userId", "testDate");

CREATE INDEX "ExternalPaperReview_userId_createdAt_idx"
ON "ExternalPaperReview"("userId", "createdAt");

ALTER TABLE "ExternalPaperReview"
ADD CONSTRAINT "ExternalPaperReview_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
