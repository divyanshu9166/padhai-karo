import { withAuth } from '@/lib/auth';
import { deleteAccountHandler } from '@/services/account';

export const DELETE = withAuth((request, auth) => deleteAccountHandler(request, auth));
