import { withAuth } from '@/lib/auth';
import { getCounsellingOptionsHandler, predictRoleFitHandler } from '@/services/upscc';

export const GET = withAuth((request, auth) => getCounsellingOptionsHandler(request, auth));
export const POST = withAuth((request, auth) => predictRoleFitHandler(request, auth));
