CREATE TABLE "RecallDrillAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL,
  "durationSec" INTEGER NOT NULL,
  "correct" INTEGER NOT NULL,
  "revealed" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecallDrillAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecallDrillAttempt_userId_createdAt_idx" ON "RecallDrillAttempt"("userId", "createdAt");
ALTER TABLE "RecallDrillAttempt" ADD CONSTRAINT "RecallDrillAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
