CREATE TABLE "CommunityReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "postId" TEXT,
    "messageId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunityReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunityReport_status_createdAt_idx" ON "CommunityReport"("status", "createdAt");
CREATE INDEX "CommunityReport_reporterId_createdAt_idx" ON "CommunityReport"("reporterId", "createdAt");
CREATE INDEX "CommunityReport_postId_idx" ON "CommunityReport"("postId");
CREATE INDEX "CommunityReport_messageId_idx" ON "CommunityReport"("messageId");

ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityReport" ADD CONSTRAINT "CommunityReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunityMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
