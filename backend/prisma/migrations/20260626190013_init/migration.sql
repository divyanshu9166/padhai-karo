-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ExamTrack" AS ENUM ('JEE', 'NEET');

-- CreateEnum
CREATE TYPE "ChapterStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'REVISED');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('NEW_CHAPTER', 'PRACTICE_PROBLEMS', 'REVISION', 'MOCK_ANALYSIS', 'FORMULA_DRILL');

-- CreateEnum
CREATE TYPE "MistakeCategory" AS ENUM ('SILLY_MISTAKE', 'CONCEPT_GAP', 'TIME_PRESSURE', 'NEVER_SEEN_THIS');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('SCHOOL_EXAM', 'HOLIDAY', 'MOCK_TEST');

-- CreateEnum
CREATE TYPE "LanguagePref" AS ENUM ('EN', 'HI');

-- CreateEnum
CREATE TYPE "PeakFocusWindow" AS ENUM ('MORNING', 'AFTERNOON', 'NIGHT');

-- CreateEnum
CREATE TYPE "TaskDifficulty" AS ENUM ('HARD', 'LIGHT');

-- CreateEnum
CREATE TYPE "BufferPolicy" AS ENUM ('CATCH_UP', 'EXTRA_REVISION');

-- CreateEnum
CREATE TYPE "QuestionOutcome" AS ENUM ('CORRECT', 'INCORRECT', 'UNANSWERED');

-- CreateEnum
CREATE TYPE "SyncRecordType" AS ENUM ('FOCUS_SESSION', 'PYQ_ATTEMPT', 'TIMED_PAPER_ATTEMPT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'CAPTURED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examTrack" "ExamTrack" NOT NULL,
    "targetYear" INTEGER NOT NULL,
    "currentClass" TEXT NOT NULL,
    "language" "LanguagePref" NOT NULL DEFAULT 'EN',
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "aiQuota" INTEGER NOT NULL DEFAULT 0,
    "peakFocusWindows" "PeakFocusWindow"[],
    "targetExamDate" TIMESTAMP(3),
    "revisionBufferDays" INTEGER NOT NULL DEFAULT 45,
    "bufferPolicy" "BufferPolicy" NOT NULL DEFAULT 'CATCH_UP',
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "examTrack" "ExamTrack" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ChapterStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "weightage" DOUBLE PRECISION NOT NULL,
    "weightageIsDefault" BOOLEAN NOT NULL DEFAULT false,
    "estimatedStudyHours" DOUBLE PRECISION NOT NULL,
    "taskDifficulty" "TaskDifficulty" NOT NULL,
    "weightageOverride" DOUBLE PRECISION,
    "estHoursOverride" DOUBLE PRECISION,
    "timeAllocationOverride" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedCommitment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timetable" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timetable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyBlock" (
    "id" TEXT NOT NULL,
    "timetableId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "chapterId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "isBuffer" BOOLEAN NOT NULL DEFAULT false,
    "energyLevel" TEXT NOT NULL,
    "scheduledOutsidePeak" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "focusedDurationMin" INTEGER NOT NULL,
    "sessionType" "SessionType" NOT NULL DEFAULT 'NEW_CHAPTER',
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FocusSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTimeAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "plannedMin" INTEGER NOT NULL,
    "actualMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyTimeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CalendarEventType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PYQPaper" (
    "id" TEXT NOT NULL,
    "examTrack" "ExamTrack" NOT NULL,
    "year" INTEGER NOT NULL,
    "session" TEXT,
    "durationMin" INTEGER NOT NULL,
    "answerKeyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PYQPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerKey" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnswerKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PYQ" (
    "id" TEXT NOT NULL,
    "paperId" TEXT,
    "examTrack" "ExamTrack" NOT NULL,
    "year" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "options" TEXT[],
    "correctOption" INTEGER NOT NULL,
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PYQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PYQAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperOrSetRef" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "perQuestion" JSONB NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PYQAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimedPaperAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "perQuestion" JSONB NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "timeTakenSec" INTEGER NOT NULL,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimedPaperAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MistakeJournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "submittedAnswer" INTEGER,
    "correctAnswer" INTEGER NOT NULL,
    "category" "MistakeCategory" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MistakeJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "summaryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NTAAnnouncement" (
    "id" TEXT NOT NULL,
    "examScope" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "dedupeHash" TEXT NOT NULL,
    "affectsExamDate" BOOLEAN NOT NULL DEFAULT false,
    "newExamDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NTAAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalSyncRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "SyncRecordType" NOT NULL,
    "serverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineDownload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Subject_examTrack_idx" ON "Subject"("examTrack");

-- CreateIndex
CREATE INDEX "Chapter_userId_idx" ON "Chapter"("userId");

-- CreateIndex
CREATE INDEX "Chapter_subjectId_idx" ON "Chapter"("subjectId");

-- CreateIndex
CREATE INDEX "FixedCommitment_userId_idx" ON "FixedCommitment"("userId");

-- CreateIndex
CREATE INDEX "Timetable_userId_idx" ON "Timetable"("userId");

-- CreateIndex
CREATE INDEX "StudyBlock_timetableId_idx" ON "StudyBlock"("timetableId");

-- CreateIndex
CREATE INDEX "StudyBlock_userId_idx" ON "StudyBlock"("userId");

-- CreateIndex
CREATE INDEX "FocusSession_userId_idx" ON "FocusSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FocusSession_userId_clientId_key" ON "FocusSession"("userId", "clientId");

-- CreateIndex
CREATE INDEX "DailyTimeAudit_userId_idx" ON "DailyTimeAudit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTimeAudit_userId_date_key" ON "DailyTimeAudit"("userId", "date");

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_idx" ON "CalendarEvent"("userId");

-- CreateIndex
CREATE INDEX "PYQPaper_examTrack_year_idx" ON "PYQPaper"("examTrack", "year");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerKey_paperId_key" ON "AnswerKey"("paperId");

-- CreateIndex
CREATE INDEX "PYQ_examTrack_year_subjectId_idx" ON "PYQ"("examTrack", "year", "subjectId");

-- CreateIndex
CREATE INDEX "PYQ_paperId_idx" ON "PYQ"("paperId");

-- CreateIndex
CREATE INDEX "PYQAttempt_userId_idx" ON "PYQAttempt"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PYQAttempt_userId_clientId_key" ON "PYQAttempt"("userId", "clientId");

-- CreateIndex
CREATE INDEX "TimedPaperAttempt_userId_idx" ON "TimedPaperAttempt"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TimedPaperAttempt_userId_clientId_key" ON "TimedPaperAttempt"("userId", "clientId");

-- CreateIndex
CREATE INDEX "MistakeJournalEntry_userId_idx" ON "MistakeJournalEntry"("userId");

-- CreateIndex
CREATE INDEX "MistakeJournalEntry_subjectId_idx" ON "MistakeJournalEntry"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "MistakeJournalEntry_userId_questionId_key" ON "MistakeJournalEntry"("userId", "questionId");

-- CreateIndex
CREATE INDEX "NoteSummary_userId_idx" ON "NoteSummary"("userId");

-- CreateIndex
CREATE INDEX "AiUsageEvent_userId_idx" ON "AiUsageEvent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NTAAnnouncement_dedupeHash_key" ON "NTAAnnouncement"("dedupeHash");

-- CreateIndex
CREATE INDEX "NTAAnnouncement_examScope_publishedAt_idx" ON "NTAAnnouncement"("examScope", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");

-- CreateIndex
CREATE INDEX "LocalSyncRecord_userId_idx" ON "LocalSyncRecord"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalSyncRecord_userId_clientId_key" ON "LocalSyncRecord"("userId", "clientId");

-- CreateIndex
CREATE INDEX "OfflineDownload_userId_idx" ON "OfflineDownload"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineDownload_userId_paperId_key" ON "OfflineDownload"("userId", "paperId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedCommitment" ADD CONSTRAINT "FixedCommitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timetable" ADD CONSTRAINT "Timetable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyBlock" ADD CONSTRAINT "StudyBlock_timetableId_fkey" FOREIGN KEY ("timetableId") REFERENCES "Timetable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTimeAudit" ADD CONSTRAINT "DailyTimeAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerKey" ADD CONSTRAINT "AnswerKey_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "PYQPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PYQ" ADD CONSTRAINT "PYQ_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "PYQPaper"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PYQAttempt" ADD CONSTRAINT "PYQAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedPaperAttempt" ADD CONSTRAINT "TimedPaperAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MistakeJournalEntry" ADD CONSTRAINT "MistakeJournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteSummary" ADD CONSTRAINT "NoteSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "NoteSummary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalSyncRecord" ADD CONSTRAINT "LocalSyncRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineDownload" ADD CONSTRAINT "OfflineDownload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

