-- Keep focus-session labels aligned with the UPSC/SSC task taxonomy. Existing rows retain
-- their original values; these additional values only make the timer more specific.
ALTER TYPE "SessionType" ADD VALUE IF NOT EXISTS 'NOTES_MAKING';
ALTER TYPE "SessionType" ADD VALUE IF NOT EXISTS 'ANSWER_WRITING';
ALTER TYPE "SessionType" ADD VALUE IF NOT EXISTS 'MOCK_TEST';
ALTER TYPE "SessionType" ADD VALUE IF NOT EXISTS 'CURRENT_AFFAIRS';
ALTER TYPE "SessionType" ADD VALUE IF NOT EXISTS 'QUANT_PRACTICE';
ALTER TYPE "SessionType" ADD VALUE IF NOT EXISTS 'REASONING_PRACTICE';
ALTER TYPE "SessionType" ADD VALUE IF NOT EXISTS 'VOCABULARY';
