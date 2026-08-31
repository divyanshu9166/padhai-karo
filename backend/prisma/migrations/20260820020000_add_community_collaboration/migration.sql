-- Direct buddy messaging and opt-in shared study dashboards.
CREATE TABLE "CommunityMessage" (
  "id" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommunityMessage_senderId_recipientId_createdAt_idx" ON "CommunityMessage"("senderId", "recipientId", "createdAt");
CREATE INDEX "CommunityMessage_recipientId_readAt_idx" ON "CommunityMessage"("recipientId", "readAt");
ALTER TABLE "CommunityMessage" ADD CONSTRAINT "CommunityMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityMessage" ADD CONSTRAINT "CommunityMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BuddyDashboardShare" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuddyDashboardShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuddyDashboardShare_ownerId_recipientId_key" ON "BuddyDashboardShare"("ownerId", "recipientId");
CREATE INDEX "BuddyDashboardShare_recipientId_enabled_idx" ON "BuddyDashboardShare"("recipientId", "enabled");
ALTER TABLE "BuddyDashboardShare" ADD CONSTRAINT "BuddyDashboardShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuddyDashboardShare" ADD CONSTRAINT "BuddyDashboardShare_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
