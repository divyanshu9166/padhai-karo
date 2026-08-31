ALTER TABLE "VoiceNote"
  ADD COLUMN "chapterId" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "searchText" TEXT;
CREATE INDEX "VoiceNote_userId_chapterId_idx" ON "VoiceNote"("userId", "chapterId");
