import { googleOAuthCallbackHandler } from '@/services/calendar';

export const GET = (request: Request) => googleOAuthCallbackHandler(request);
