import { withAuth } from '@/lib/auth';
import { officialPyqStatusHandler } from '@/services/pyq/officialStatusService';

export const GET = withAuth((request, auth) => officialPyqStatusHandler(request, auth));
