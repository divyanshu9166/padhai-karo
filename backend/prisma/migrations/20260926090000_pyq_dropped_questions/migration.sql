-- Official final keys can drop questions; record how many so full mocks and scoring account for them.
ALTER TABLE "PYQPaper" ADD COLUMN "droppedQuestionCount" INTEGER NOT NULL DEFAULT 0;
