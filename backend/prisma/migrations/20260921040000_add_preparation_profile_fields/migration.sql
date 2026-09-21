-- Lightweight preparation-profile inputs used by the UPSC/SSC-first onboarding flow.
ALTER TABLE "Profile" ADD COLUMN "preparationProfile" TEXT;
ALTER TABLE "Profile" ADD COLUMN "weekdayStudyMinutes" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "weekendStudyMinutes" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "optionalSubject" TEXT;
