/**
 * GET /api/reference/exam-date?track=JEE|NEET&year=YYYY (task 3.2, design "Reference
 * Data Service").
 *
 * Reference reads are authenticated per the design "Authentication Posture": the
 * session-validation guard ({@link withAuth}, task 2.3) rejects requests lacking a valid
 * session token with `401 UNAUTHORIZED` before delegating to the Reference Data Service
 * handler, which returns the Target_Exam_Date for the track/year or 404 NOT_FOUND.
 */
import { withAuth } from '@/lib/auth';
import { examDateHandler } from '@/services/reference/referenceService';

export const GET = withAuth((request) => examDateHandler(request));
