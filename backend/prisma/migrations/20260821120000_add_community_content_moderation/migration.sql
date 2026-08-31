-- Additive moderation state for community content. Existing posts/messages remain visible.
CREATE TYPE "CommunityContentStatus" AS ENUM ('VISIBLE', 'HIDDEN');

ALTER TABLE "CommunityPost"
ADD COLUMN "moderationStatus" "CommunityContentStatus" NOT NULL DEFAULT 'VISIBLE';

ALTER TABLE "CommunityMessage"
ADD COLUMN "moderationStatus" "CommunityContentStatus" NOT NULL DEFAULT 'VISIBLE';

CREATE INDEX "CommunityPost_moderationStatus_createdAt_idx"
ON "CommunityPost"("moderationStatus", "createdAt");

CREATE INDEX "CommunityMessage_moderationStatus_createdAt_idx"
ON "CommunityMessage"("moderationStatus", "createdAt");
