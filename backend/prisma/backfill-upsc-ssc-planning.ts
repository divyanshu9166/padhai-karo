import { PrismaClient } from '@prisma/client';

import { getSubjectsForStage, getUnitPlanningProfile, type ExamProgramKey, type ExamStage, type UnitPlanningProfile } from '../src/lib/exams';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    const profiles = await prisma.profile.findMany({
        where: { examProgram: { in: ['UPSC_CSE', 'SSC_CGL'] }, examStage: { not: null } },
        select: { userId: true, examProgram: true, examStage: true },
    });
    let updated = 0;

    for (const profile of profiles) {
        const program = profile.examProgram as ExamProgramKey;
        const stage = profile.examStage as ExamStage;
        const defaults = new Map<string, UnitPlanningProfile>(
            getSubjectsForStage(program, stage).flatMap((subject) =>
                subject.units.map((unit, index) => [
                    `${subject.key}-${index + 1}`,
                    getUnitPlanningProfile(program, stage, unit, subject.planningPriority),
                ] as const),
            ),
        );
        const chapters = await prisma.chapter.findMany({
            where: {
                userId: profile.userId,
                weightageIsDefault: true,
                weightageOverride: null,
                estHoursOverride: null,
                timeAllocationOverride: null,
            },
            select: { id: true, referenceKey: true },
        });
        const writes = chapters.flatMap((chapter) => {
            const planning = defaults.get(chapter.referenceKey);
            return planning ? [prisma.chapter.update({
                where: { id: chapter.id },
                data: {
                    weightage: planning.planningWeight,
                    estimatedStudyHours: planning.estimatedStudyHours,
                    taskDifficulty: planning.taskDifficulty,
                },
            })] : [];
        });
        if (writes.length > 0) {
            await prisma.$transaction(writes);
            updated += writes.length;
        }
    }
    console.log(`Updated ${updated} untouched UPSC/SSC planning chapter(s) across ${profiles.length} profile(s).`);
}

main()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(async () => prisma.$disconnect());
