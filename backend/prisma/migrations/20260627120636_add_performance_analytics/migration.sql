-- CreateEnum
CREATE TYPE "MockSeriesSource" AS ENUM ('ALLEN', 'AAKASH', 'OTHER');

-- CreateEnum
CREATE TYPE "CutoffUnit" AS ENUM ('RANK', 'PERCENTILE', 'MARKS');

-- CreateEnum
CREATE TYPE "ReferenceDatasetType" AS ENUM ('CUTOFF', 'SCORE_STANDING_MAP', 'TOPIC_FREQUENCY');

-- CreateTable
CREATE TABLE "ExternalMockScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "MockSeriesSource" NOT NULL,
    "sourceName" TEXT,
    "testDate" TIMESTAMP(3) NOT NULL,
    "obtainedScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalMockScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetCollegeCutoffSelection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cutoffReferenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetCollegeCutoffSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionTopicMap" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "examTrack" "ExamTrack" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "topicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionTopicMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CutoffReferenceData" (
    "id" TEXT NOT NULL,
    "examTrack" "ExamTrack" NOT NULL,
    "referenceDataYear" INTEGER NOT NULL,
    "collegeName" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "closingValue" DOUBLE PRECISION NOT NULL,
    "unit" "CutoffUnit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CutoffReferenceData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreStandingMap" (
    "id" TEXT NOT NULL,
    "examTrack" "ExamTrack" NOT NULL,
    "referenceDataYear" INTEGER NOT NULL,
    "minScorePercent" DOUBLE PRECISION NOT NULL,
    "maxScorePercent" DOUBLE PRECISION NOT NULL,
    "estimateLow" DOUBLE PRECISION NOT NULL,
    "estimateHigh" DOUBLE PRECISION NOT NULL,
    "unit" "CutoffUnit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreStandingMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicFrequencyReferenceData" (
    "id" TEXT NOT NULL,
    "examTrack" "ExamTrack" NOT NULL,
    "referenceDataYear" INTEGER NOT NULL,
    "topicKey" TEXT NOT NULL,
    "topicName" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "appearanceCount" INTEGER NOT NULL,
    "yearSpanStart" INTEGER NOT NULL,
    "yearSpanEnd" INTEGER NOT NULL,
    "avgQuestionsPerYear" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicFrequencyReferenceData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalMockScore_userId_idx" ON "ExternalMockScore"("userId");

-- CreateIndex
CREATE INDEX "ExternalMockScore_userId_testDate_idx" ON "ExternalMockScore"("userId", "testDate");

-- CreateIndex
CREATE UNIQUE INDEX "TargetCollegeCutoffSelection_userId_key" ON "TargetCollegeCutoffSelection"("userId");

-- CreateIndex
CREATE INDEX "TargetCollegeCutoffSelection_userId_idx" ON "TargetCollegeCutoffSelection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionTopicMap_questionId_key" ON "QuestionTopicMap"("questionId");

-- CreateIndex
CREATE INDEX "QuestionTopicMap_topicKey_idx" ON "QuestionTopicMap"("topicKey");

-- CreateIndex
CREATE INDEX "QuestionTopicMap_subjectId_idx" ON "QuestionTopicMap"("subjectId");

-- CreateIndex
CREATE INDEX "CutoffReferenceData_examTrack_referenceDataYear_idx" ON "CutoffReferenceData"("examTrack", "referenceDataYear");

-- CreateIndex
CREATE UNIQUE INDEX "CutoffReferenceData_examTrack_referenceDataYear_collegeName_key" ON "CutoffReferenceData"("examTrack", "referenceDataYear", "collegeName", "branchName", "category");

-- CreateIndex
CREATE INDEX "ScoreStandingMap_examTrack_referenceDataYear_idx" ON "ScoreStandingMap"("examTrack", "referenceDataYear");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreStandingMap_examTrack_referenceDataYear_minScorePercen_key" ON "ScoreStandingMap"("examTrack", "referenceDataYear", "minScorePercent", "maxScorePercent");

-- CreateIndex
CREATE INDEX "TopicFrequencyReferenceData_examTrack_referenceDataYear_idx" ON "TopicFrequencyReferenceData"("examTrack", "referenceDataYear");

-- CreateIndex
CREATE UNIQUE INDEX "TopicFrequencyReferenceData_examTrack_referenceDataYear_top_key" ON "TopicFrequencyReferenceData"("examTrack", "referenceDataYear", "topicKey");

-- AddForeignKey
ALTER TABLE "ExternalMockScore" ADD CONSTRAINT "ExternalMockScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetCollegeCutoffSelection" ADD CONSTRAINT "TargetCollegeCutoffSelection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetCollegeCutoffSelection" ADD CONSTRAINT "TargetCollegeCutoffSelection_cutoffReferenceId_fkey" FOREIGN KEY ("cutoffReferenceId") REFERENCES "CutoffReferenceData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
