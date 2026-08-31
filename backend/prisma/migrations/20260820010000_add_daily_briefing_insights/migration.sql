-- Persist the complete generated daily briefing, including AI/rule-based insights.
ALTER TABLE "DailyBriefing"
ADD COLUMN "insights" JSONB;
