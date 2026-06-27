/**
 * Liveness probe for the API-only service. Confirms the Next.js App Router API surface
 * is wired up. Feature endpoints are added in later task groups.
 */
export async function GET(): Promise<Response> {
    return Response.json({ status: 'ok', service: 'jee-neet-study-app-backend' });
}
