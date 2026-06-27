/**
 * GET / PUT /api/allocation/mode (task 12.1; design "API endpoints"; Req 7.1, 7.2, 7.6,
 * 10.1, 10.3, 10.4).
 *
 * Protected endpoints for reading and persisting the User's Effective_Allocation_Mode. The
 * session-validation guard ({@link withAuth}) rejects unauthenticated requests with
 * `401 UNAUTHORIZED` (Req 10.1) and supplies the authenticated context so every query is
 * scoped to `ctx.user.id`. The handler logic lives in the Allocation Service so this route
 * file stays framework-thin. `PUT` returns `422` on an invalid mode value.
 */
import { withAuth } from '@/lib/auth';
import {
    getAllocationModeHandler,
    updateAllocationModeHandler,
} from '@/services/allocation/modeService';

export const GET = withAuth((request, ctx) => getAllocationModeHandler(request, ctx));

export const PUT = withAuth((request, ctx) => updateAllocationModeHandler(request, ctx));
