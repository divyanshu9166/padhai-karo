/**
 * GET /api/reference/chapters?track=JEE|NEET (task 3.2, design "Reference Data Service").
 *
 * Reference reads are authenticated per the design "Authentication Posture": the
 * session-validation guard ({@link withAuth}, task 2.3) rejects requests lacking a valid
 * session token with `401 UNAUTHORIZED` before delegating to the Reference Data Service
 * handler, which returns the track's chapters annotated with their owning subject.
 */
import { withAuth } from '@/lib/auth';
import { chaptersHandler } from '@/services/reference/referenceService';

export const GET = withAuth((request) => chaptersHandler(request));
