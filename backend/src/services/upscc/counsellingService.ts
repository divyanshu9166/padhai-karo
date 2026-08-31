import type { AuthContext } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ErrorCode, errorResponse } from '@/lib/errors';

const UPSC_ROLES = [
    { name: 'Indian Administrative Service', fit: 'public administration, policy and district leadership', next: 'Compare service conditions and cadre rules from the latest official notice.' },
    { name: 'Indian Police Service', fit: 'public safety, leadership and field operations', next: 'Review medical, physical and service-specific requirements.' },
    { name: 'Indian Revenue / Audit Services', fit: 'tax, finance, compliance and analytical work', next: 'Compare work profile, postings and promotion context.' },
];
const SSC_ROLES = [
    { name: 'Assistant Section Officer', fit: 'policy files, coordination and central secretariat work', next: 'Compare department, city and promotion path.' },
    { name: 'Inspector posts', fit: 'tax, compliance, investigation and field work', next: 'Check physical and department-specific conditions.' },
    { name: 'Auditor / Accountant', fit: 'numbers, verification and public finance', next: 'Compare workload, location and long-term role fit.' },
];

export async function getCounsellingOptionsHandler(_request: Request, auth: AuthContext): Promise<Response> {
    const profile = await prisma.profile.findUnique({ where: { userId: auth.user.id }, select: { examProgram: true, examStage: true } });
    if (!profile?.examProgram) return errorResponse(404, ErrorCode.NOT_FOUND, 'Complete onboarding first.');
    return Response.json({ examProgram: profile.examProgram, stage: profile.examStage, roles: profile.examProgram === 'UPSC_CSE' ? UPSC_ROLES : SSC_ROLES, disclaimer: 'This is a reflection aid, not an official rank, college or service-allocation prediction. Verify every decision against the latest official notice.' });
}

export async function predictRoleFitHandler(request: Request, auth: AuthContext): Promise<Response> {
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    const options = await getCounsellingOptionsHandler(request, auth); const payload = await options.json() as { examProgram?: string; roles?: Array<{ name: string; fit: string; next: string }>; disclaimer?: string };
    const score = typeof input.scorePercent === 'number' ? Math.max(0, Math.min(100, input.scorePercent)) : null;
    const interests = Array.isArray(input.interests) ? input.interests.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase()) : [];
    const ranked = (payload.roles ?? []).map((role) => ({ ...role, fitScore: Math.round((score ?? 50) * 0.35 + (interests.some((interest) => role.fit.toLowerCase().includes(interest)) ? 55 : 35)) })).sort((a, b) => b.fitScore - a.fitScore);
    return Response.json({ predictions: ranked, scorePercent: score, disclaimer: payload.disclaimer ?? 'Verify every decision against the latest official notice.' });
}
