/**
 * /api/ai/summaries (task 16.1, design "AI Notes Service (Req 8, 9)").
 *
 * POST creates a structured note summary, gated by subscription tier and AI quota with the
 * exact usage-accounting order defined in the design ("AI Notes Request Flow & Usage
 * Accounting"). GET lists the authenticated user's summaries.
 *
 * Both are guarded per the design "Authentication Posture": the request must carry a valid
 * `Authorization: Bearer <token>` session, enforced by {@link withAuth} (task 2.3) which
 * rejects unauthenticated requests with 401 UNAUTHORIZED before the handler runs. Core
 * features remain ungated for all tiers (Req 9.4); only AI notes are tier/quota-gated, and
 * that gating lives inside the handler.
 *
 * The handler logic lives in the AI notes service so it stays free of framework/guard
 * concerns. The concrete AI provider is injected by the service (a mock is used in tests).
 */
import { withAuth } from '@/lib/auth';
import { createOpenNoteHandler, listOpenNotesHandler } from '@/services/ai/openNotesService';

// Keep the older URL as a compatibility alias, but route it through the same implementation
// as /api/ai/notes so photo/voice inputs, quota safety and generation-source metadata stay in sync.
export const POST = withAuth((request, auth) => createOpenNoteHandler(request, auth));
export const GET = withAuth((request, auth) => listOpenNotesHandler(request, auth));
