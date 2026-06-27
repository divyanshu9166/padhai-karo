-- CreateEnum
CREATE TYPE "EffectiveAllocationMode" AS ENUM ('SUGGESTED', 'PHASE1_DEFAULT');

-- CreateTable
CREATE TABLE "AllocationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "EffectiveAllocationMode" NOT NULL DEFAULT 'PHASE1_DEFAULT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestedAllocationSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referenceDataYear" INTEGER NOT NULL,
    "shares" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuggestedAllocationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllocationPreference_userId_key" ON "AllocationPreference"("userId");

-- CreateIndex
CREATE INDEX "AllocationPreference_userId_idx" ON "AllocationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestedAllocationSnapshot_userId_key" ON "SuggestedAllocationSnapshot"("userId");

-- CreateIndex
CREATE INDEX "SuggestedAllocationSnapshot_userId_idx" ON "SuggestedAllocationSnapshot"("userId");

-- AddForeignKey
ALTER TABLE "AllocationPreference" ADD CONSTRAINT "AllocationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestedAllocationSnapshot" ADD CONSTRAINT "SuggestedAllocationSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
