ALTER TABLE "CalendarConnection" ADD COLUMN IF NOT EXISTS "accessTokenCipher" TEXT;
ALTER TABLE "CalendarConnection" ADD COLUMN IF NOT EXISTS "refreshTokenCipher" TEXT;
ALTER TABLE "CalendarConnection" ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3);
