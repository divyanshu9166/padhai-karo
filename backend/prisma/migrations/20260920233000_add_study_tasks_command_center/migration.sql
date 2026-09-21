-- Student-facing task layer: turns timetable blocks and quick capture into actionable work.
CREATE TYPE "StudyTaskType" AS ENUM (
  'READING', 'NOTES_MAKING', 'REVISION', 'PYQ_PRACTICE', 'ANSWER_WRITING',
  'MOCK_TEST', 'MOCK_ANALYSIS', 'CURRENT_AFFAIRS', 'QUANT_PRACTICE',
  'REASONING_PRACTICE', 'VOCABULARY', 'FORMULA_REVISION'
);

CREATE TYPE "StudyTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "StudyTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'MISSED');
CREATE TYPE "StudyTaskSource" AS ENUM ('MANUAL', 'PLANNER', 'REVISION', 'WEAK_AREA', 'CURRENT_AFFAIRS', 'QUICK_CAPTURE');

CREATE TABLE "StudyTask" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "studyBlockId" TEXT,
  "title" TEXT NOT NULL,
  "syllabusUnit" TEXT,
  "subjectId" TEXT,
  "chapterId" TEXT,
  "examProgram" "ExamProgram",
  "examStage" "ExamStage",
  "taskType" "StudyTaskType" NOT NULL,
  "plannedMinutes" INTEGER NOT NULL,
  "scheduledDate" TIMESTAMP(3),
  "priority" "StudyTaskPriority" NOT NULL DEFAULT 'NORMAL',
  "status" "StudyTaskStatus" NOT NULL DEFAULT 'PENDING',
  "source" "StudyTaskSource" NOT NULL DEFAULT 'MANUAL',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyTask_studyBlockId_key" ON "StudyTask"("studyBlockId");
CREATE INDEX "StudyTask_userId_scheduledDate_status_idx" ON "StudyTask"("userId", "scheduledDate", "status");
CREATE INDEX "StudyTask_userId_status_priority_idx" ON "StudyTask"("userId", "status", "priority");
CREATE INDEX "StudyTask_userId_source_idx" ON "StudyTask"("userId", "source");

ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_studyBlockId_fkey"
  FOREIGN KEY ("studyBlockId") REFERENCES "StudyBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FocusSession" ADD COLUMN "taskId" TEXT;
CREATE INDEX "FocusSession_taskId_idx" ON "FocusSession"("taskId");
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CurrentAffairsItem" ADD COLUMN "syllabusTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CurrentAffairsItem" ADD COLUMN "prelimsRelevance" TEXT;
ALTER TABLE "CurrentAffairsItem" ADD COLUMN "mainsRelevance" TEXT;
