ALTER TABLE "StudyBlock" ADD COLUMN "revisionLabel" TEXT;
ALTER TABLE "RevisionCard" ADD COLUMN "revisionPhase" TEXT;
ALTER TYPE "SyncRecordType" ADD VALUE 'PDF_ANNOTATION';
