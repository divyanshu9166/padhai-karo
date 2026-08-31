/**
 * GET /api/reference/exam-programs
 *
 * Authenticated read endpoint for the UPSC/SSC exam-program registry. The existing
 * `/reference/subjects?track=...` endpoints are intentionally left unchanged during
 * the additive migration from the JEE/NEET domain model.
 */
import { withAuth } from '@/lib/auth';
import { examProgramsHandler } from '@/services/reference/referenceService';

export const GET = withAuth((request) => examProgramsHandler(request));
