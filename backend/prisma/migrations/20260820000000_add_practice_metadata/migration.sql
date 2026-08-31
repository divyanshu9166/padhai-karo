-- Additive metadata for revision-aware timetable blocks and verified official PYQ imports.
ALTER TABLE "StudyBlock"
ADD COLUMN "sessionType" "SessionType" NOT NULL DEFAULT 'NEW_CHAPTER',
ADD COLUMN "revisionNumber" INTEGER;

ALTER TABLE "PYQPaper"
ADD COLUMN "sourceName" TEXT,
ADD COLUMN "sourceUrl" TEXT,
ADD COLUMN "verificationMethod" TEXT,
ADD COLUMN "verifiedAt" TIMESTAMP(3);
