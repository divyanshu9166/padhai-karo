import { withAuth } from '@/lib/auth';
import { registerPushDeviceHandler, unregisterPushDeviceHandler } from '@/services/notifications';

export const POST = withAuth((request, auth) => registerPushDeviceHandler(request, auth));
export const DELETE = withAuth((request, auth) => unregisterPushDeviceHandler(request, auth));
