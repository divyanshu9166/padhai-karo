ALTER TABLE "MockExamAttempt"
  ADD COLUMN "obtainedScore" DOUBLE PRECISION,
  ADD COLUMN "maximumScore" DOUBLE PRECISION,
  ADD COLUMN "correctCount" INTEGER,
  ADD COLUMN "incorrectCount" INTEGER,
  ADD COLUMN "unansweredCount" INTEGER,
  ADD COLUMN "negativeMarks" DOUBLE PRECISION;
