ALTER TABLE "PdfDocument"
  ADD COLUMN IF NOT EXISTS "fileName" TEXT,
  ADD COLUMN IF NOT EXISTS "fileMimeType" TEXT DEFAULT 'application/pdf',
  ADD COLUMN IF NOT EXISTS "fileData" BYTEA,
  ADD COLUMN IF NOT EXISTS "fileChecksum" TEXT,
  ADD COLUMN IF NOT EXISTS "pageText" JSONB;

ALTER TABLE "VoiceNote"
  ADD COLUMN IF NOT EXISTS "audioFileName" TEXT,
  ADD COLUMN IF NOT EXISTS "audioMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "audioData" BYTEA;

ALTER TABLE "CalendarConnection"
  ADD COLUMN IF NOT EXISTS "syncToken" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'CONNECTED';

ALTER TABLE "PdfAnnotation"
  ADD COLUMN IF NOT EXISTS "selectionStart" INTEGER,
  ADD COLUMN IF NOT EXISTS "selectionEnd" INTEGER,
  ADD COLUMN IF NOT EXISTS "rect" JSONB;

ALTER TABLE "CalendarEvent"
  ADD COLUMN IF NOT EXISTS "externalId" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'MANUAL';
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEvent_userId_externalId_key" ON "CalendarEvent"("userId", "externalId");

CREATE TABLE IF NOT EXISTS "OfflineMutation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfflineMutation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OfflineMutation_userId_clientId_key" ON "OfflineMutation"("userId", "clientId");
CREATE INDEX IF NOT EXISTS "OfflineMutation_userId_status_createdAt_idx" ON "OfflineMutation"("userId", "status", "createdAt");
DO $$ BEGIN
  ALTER TABLE "OfflineMutation" ADD CONSTRAINT "OfflineMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
