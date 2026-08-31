-- UPSC/SSC learning, planning, wellbeing, current-affairs and community features.
-- Business/subscription tables and legacy JEE/NEET tables are intentionally untouched.

ALTER TYPE "SyncRecordType" ADD VALUE 'ANSWER_WRITING_ATTEMPT';
ALTER TYPE "SyncRecordType" ADD VALUE 'WELLBEING_CHECKIN';
ALTER TYPE "SyncRecordType" ADD VALUE 'VOICE_NOTE';

CREATE TABLE "AnswerWritingAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectId" TEXT,
  "prompt" TEXT NOT NULL,
  "answerText" TEXT NOT NULL,
  "wordCount" INTEGER NOT NULL,
  "timeTakenSec" INTEGER,
  "selfScore" DOUBLE PRECISION,
  "feedback" JSONB,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnswerWritingAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnswerWritingAttempt_userId_createdAt_idx" ON "AnswerWritingAttempt"("userId", "createdAt");
CREATE INDEX "AnswerWritingAttempt_userId_subjectId_idx" ON "AnswerWritingAttempt"("userId", "subjectId");
ALTER TABLE "AnswerWritingAttempt" ADD CONSTRAINT "AnswerWritingAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyBriefing" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "briefingDate" TIMESTAMP(3) NOT NULL,
  "phase" TEXT NOT NULL,
  "countdownDays" INTEGER,
  "priorities" JSONB NOT NULL,
  "schedule" JSONB NOT NULL,
  "wellbeing" JSONB,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyBriefing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailyBriefing_userId_briefingDate_key" ON "DailyBriefing"("userId", "briefingDate");
CREATE INDEX "DailyBriefing_userId_briefingDate_idx" ON "DailyBriefing"("userId", "briefingDate");
ALTER TABLE "DailyBriefing" ADD CONSTRAINT "DailyBriefing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WellbeingCheckin" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "checkinDate" TIMESTAMP(3) NOT NULL,
  "mood" INTEGER NOT NULL,
  "energy" INTEGER NOT NULL,
  "stress" INTEGER NOT NULL,
  "sleepHours" DOUBLE PRECISION,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WellbeingCheckin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WellbeingCheckin_userId_checkinDate_key" ON "WellbeingCheckin"("userId", "checkinDate");
CREATE INDEX "WellbeingCheckin_userId_checkinDate_idx" ON "WellbeingCheckin"("userId", "checkinDate");
ALTER TABLE "WellbeingCheckin" ADD CONSTRAINT "WellbeingCheckin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SleepSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bedtime" TEXT NOT NULL,
  "wakeTime" TEXT NOT NULL,
  "windDownMin" INTEGER NOT NULL DEFAULT 30,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SleepSchedule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SleepSchedule_userId_key" ON "SleepSchedule"("userId");
ALTER TABLE "SleepSchedule" ADD CONSTRAINT "SleepSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CurrentAffairsItem" (
  "id" TEXT NOT NULL,
  "examProgram" "ExamProgram",
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "body" TEXT,
  "category" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL,
  "sourceName" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "dedupeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CurrentAffairsItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CurrentAffairsItem_dedupeHash_key" ON "CurrentAffairsItem"("dedupeHash");
CREATE INDEX "CurrentAffairsItem_examProgram_publishedAt_idx" ON "CurrentAffairsItem"("examProgram", "publishedAt");
CREATE INDEX "CurrentAffairsItem_category_publishedAt_idx" ON "CurrentAffairsItem"("category", "publishedAt");

CREATE TABLE "CurrentAffairsBookmark" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "notes" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CurrentAffairsBookmark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CurrentAffairsBookmark_userId_itemId_key" ON "CurrentAffairsBookmark"("userId", "itemId");
CREATE INDEX "CurrentAffairsBookmark_userId_read_idx" ON "CurrentAffairsBookmark"("userId", "read");
ALTER TABLE "CurrentAffairsBookmark" ADD CONSTRAINT "CurrentAffairsBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurrentAffairsBookmark" ADD CONSTRAINT "CurrentAffairsBookmark_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CurrentAffairsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudyResource" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectId" TEXT,
  "chapterId" TEXT,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "type" TEXT NOT NULL DEFAULT 'LINK',
  "tags" TEXT[] NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyResource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudyResource_userId_createdAt_idx" ON "StudyResource"("userId", "createdAt");
CREATE INDEX "StudyResource_userId_subjectId_idx" ON "StudyResource"("userId", "subjectId");
ALTER TABLE "StudyResource" ADD CONSTRAINT "StudyResource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PdfDocument" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "fileUrl" TEXT,
  "extractedText" TEXT,
  "tags" TEXT[] NOT NULL,
  "pageCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PdfDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PdfDocument_userId_createdAt_idx" ON "PdfDocument"("userId", "createdAt");
ALTER TABLE "PdfDocument" ADD CONSTRAINT "PdfDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "VoiceNote" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "audioUri" TEXT,
  "transcription" TEXT,
  "durationSec" INTEGER,
  "subjectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VoiceNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VoiceNote_userId_createdAt_idx" ON "VoiceNote"("userId", "createdAt");
ALTER TABLE "VoiceNote" ADD CONSTRAINT "VoiceNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommunityPost" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "examProgram" "ExamProgram",
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL,
  "anonymous" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommunityPost_examProgram_createdAt_idx" ON "CommunityPost"("examProgram", "createdAt");
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudyBuddy" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyBuddy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudyBuddy_requesterId_recipientId_key" ON "StudyBuddy"("requesterId", "recipientId");
CREATE INDEX "StudyBuddy_recipientId_status_idx" ON "StudyBuddy"("recipientId", "status");
ALTER TABLE "StudyBuddy" ADD CONSTRAINT "StudyBuddy_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyBuddy" ADD CONSTRAINT "StudyBuddy_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CalendarConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalCalendarId" TEXT,
  "lastImportedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarConnection_userId_provider_key" ON "CalendarConnection"("userId", "provider");
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dailyBriefing" BOOLEAN NOT NULL DEFAULT true,
  "revisionReminders" BOOLEAN NOT NULL DEFAULT true,
  "currentAffairs" BOOLEAN NOT NULL DEFAULT true,
  "wellbeing" BOOLEAN NOT NULL DEFAULT true,
  "quietStart" TEXT,
  "quietEnd" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ExamDate" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "examProgram" "ExamProgram",
  "examStage" "ExamStage",
  "label" TEXT NOT NULL,
  "examDate" TIMESTAMP(3) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamDate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExamDate_userId_examDate_idx" ON "ExamDate"("userId", "examDate");
ALTER TABLE "ExamDate" ADD CONSTRAINT "ExamDate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
