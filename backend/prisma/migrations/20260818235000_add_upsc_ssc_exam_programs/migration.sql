-- Additive UPSC/SSC exam-program metadata. Legacy JEE/NEET rows remain valid.
ALTER TYPE "ExamTrack" ADD VALUE 'UPSC';
ALTER TYPE "ExamTrack" ADD VALUE 'SSC';

CREATE TYPE "ExamProgram" AS ENUM ('UPSC_CSE', 'SSC_CGL');
CREATE TYPE "ExamStage" AS ENUM ('PRELIMS', 'MAINS', 'TIER_1', 'TIER_2');

ALTER TABLE "Profile"
  ADD COLUMN "examProgram" "ExamProgram",
  ADD COLUMN "examStage" "ExamStage";

ALTER TABLE "Subject"
  ADD COLUMN "examProgram" "ExamProgram",
  ADD COLUMN "examStage" "ExamStage";

CREATE INDEX "Subject_examProgram_examStage_idx"
  ON "Subject"("examProgram", "examStage");

ALTER TABLE "PYQPaper"
  ADD COLUMN "examProgram" "ExamProgram",
  ADD COLUMN "examStage" "ExamStage",
  ADD COLUMN "paperKey" TEXT;

ALTER TABLE "PYQ"
  ADD COLUMN "examProgram" "ExamProgram",
  ADD COLUMN "examStage" "ExamStage";
