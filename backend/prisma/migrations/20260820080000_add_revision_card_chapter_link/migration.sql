ALTER TABLE "RevisionCard" ADD COLUMN "chapterId" TEXT;

CREATE INDEX "RevisionCard_userId_chapterId_idx" ON "RevisionCard"("userId", "chapterId");
