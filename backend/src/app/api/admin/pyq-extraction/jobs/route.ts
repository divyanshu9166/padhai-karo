/**
 * POST /api/admin/pyq-extraction/jobs (task 12.2, design "PYQ Extraction Pipeline
 * (Worker, Req 7)").
 *
 * Operator endpoint that enqueues a `pyq-extraction` BullMQ job and returns 202 { jobId }.
 * Guarded by {@link withAuth} (task 2.3): unauthenticated requests are rejected with
 * 401 UNAUTHORIZED before the handler runs. These are operator/admin endpoints; the schema
 * has no admin-role concept yet, so for now an authenticated session is required — see the
 * TODO(admin-role) note in the service for the future role check.
 *
 * The handler logic lives in the PYQ-extraction admin service so it stays free of
 * framework/guard concerns and keeps the queue interaction injectable for tests.
 */
import { withAuth } from '@/lib/auth';
import { createPyqExtractionJobHandler } from '@/services/pyqExtractionAdmin';

export const POST = withAuth((request, ctx) => createPyqExtractionJobHandler(request, ctx));
