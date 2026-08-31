-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LanguagePref" ADD VALUE 'TA';
ALTER TYPE "LanguagePref" ADD VALUE 'BN';
ALTER TYPE "LanguagePref" ADD VALUE 'TE';
ALTER TYPE "LanguagePref" ADD VALUE 'MR';

-- CreateTable
CREATE TABLE "RevisionCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "tags" TEXT[],
    "dueAt" TIMESTAMP(3) NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevisionCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevisionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "chapterId" TEXT,
    "title" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "explanation" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormulaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptMap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConceptMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickRevisionCapsule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chapterId" TEXT,
    "title" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "sourceNoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickRevisionCapsule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockExamAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paperId" TEXT,
    "title" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "currentQuestion" INTEGER NOT NULL DEFAULT 0,
    "answers" JSONB NOT NULL,
    "markedForReview" JSONB NOT NULL,
    "sectionTimings" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "totalScore" INTEGER,
    "maxScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PacingAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT,
    "questionCount" INTEGER NOT NULL,
    "targetSeconds" INTEGER NOT NULL,
    "actualSeconds" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PacingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamChecklistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examDateId" TEXT,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyMilestone" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "achievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopperStrategy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopperStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnxietyProtocolLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "durationSec" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnxietyProtocolLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "dailyPlan" JSONB NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachingConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoubtItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "tags" TEXT[],
    "resourceUrls" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoubtItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarOAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevisionCard_userId_dueAt_idx" ON "RevisionCard"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "RevisionCard_userId_sourceType_idx" ON "RevisionCard"("userId", "sourceType");

-- CreateIndex
CREATE INDEX "RevisionReview_userId_reviewedAt_idx" ON "RevisionReview"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "FormulaItem_userId_subjectId_idx" ON "FormulaItem"("userId", "subjectId");

-- CreateIndex
CREATE INDEX "FormulaItem_userId_chapterId_idx" ON "FormulaItem"("userId", "chapterId");

-- CreateIndex
CREATE INDEX "ConceptMap_userId_updatedAt_idx" ON "ConceptMap"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "QuickRevisionCapsule_userId_chapterId_idx" ON "QuickRevisionCapsule"("userId", "chapterId");

-- CreateIndex
CREATE INDEX "MockExamAttempt_userId_status_idx" ON "MockExamAttempt"("userId", "status");

-- CreateIndex
CREATE INDEX "MockExamAttempt_userId_createdAt_idx" ON "MockExamAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PacingAttempt_userId_createdAt_idx" ON "PacingAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ExamChecklistItem_userId_completed_idx" ON "ExamChecklistItem"("userId", "completed");

-- CreateIndex
CREATE INDEX "StudyMilestone_userId_achievedAt_idx" ON "StudyMilestone"("userId", "achievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudyMilestone_userId_key_key" ON "StudyMilestone"("userId", "key");

-- CreateIndex
CREATE INDEX "TopperStrategy_userId_createdAt_idx" ON "TopperStrategy"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AnxietyProtocolLog_userId_createdAt_idx" ON "AnxietyProtocolLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryPlan_userId_startDate_idx" ON "RecoveryPlan"("userId", "startDate");

-- CreateIndex
CREATE INDEX "CoachingConnection_userId_status_idx" ON "CoachingConnection"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CoachingConnection_userId_provider_externalId_key" ON "CoachingConnection"("userId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "DoubtItem_userId_status_idx" ON "DoubtItem"("userId", "status");

-- CreateIndex
CREATE INDEX "DoubtItem_userId_createdAt_idx" ON "DoubtItem"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PushDevice_userId_active_idx" ON "PushDevice"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_userId_expoPushToken_key" ON "PushDevice"("userId", "expoPushToken");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarOAuthState_state_key" ON "CalendarOAuthState"("state");

-- CreateIndex
CREATE INDEX "CalendarOAuthState_userId_expiresAt_idx" ON "CalendarOAuthState"("userId", "expiresAt");

-- CreateIndex

-- AddForeignKey
ALTER TABLE "RevisionCard" ADD CONSTRAINT "RevisionCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionReview" ADD CONSTRAINT "RevisionReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionReview" ADD CONSTRAINT "RevisionReview_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "RevisionCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaItem" ADD CONSTRAINT "FormulaItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptMap" ADD CONSTRAINT "ConceptMap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickRevisionCapsule" ADD CONSTRAINT "QuickRevisionCapsule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockExamAttempt" ADD CONSTRAINT "MockExamAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PacingAttempt" ADD CONSTRAINT "PacingAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamChecklistItem" ADD CONSTRAINT "ExamChecklistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMilestone" ADD CONSTRAINT "StudyMilestone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopperStrategy" ADD CONSTRAINT "TopperStrategy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnxietyProtocolLog" ADD CONSTRAINT "AnxietyProtocolLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryPlan" ADD CONSTRAINT "RecoveryPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachingConnection" ADD CONSTRAINT "CoachingConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoubtItem" ADD CONSTRAINT "DoubtItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarOAuthState" ADD CONSTRAINT "CalendarOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
