/**
 * Pure, database-free decision logic for the Adaptive_Rebalancer and the unused-buffer
 * conversion (task 6.8; design "Adaptive Rebalancer"; Req 15.2, 15.3, 15.4, 15.5).
 *
 * Everything here is a small total function over plain data so it can be unit-tested without
 * a database and reused by the property tests (Properties 18/19, tasks 6.19/6.20). The thin
 * `./rebalanceService` handlers load rows, call into these functions, and apply the resulting
 * plan inside a transaction — no scheduling intelligence lives in the I/O layer.
 *
 * ── Representation decisions (documented) ─────────────────────────────────────────────────
 *
 *   "Move the missed block's work into a buffer" (Req 15.2): the chosen `Buffer_Slot` is
 *   REPURPOSED in place — it keeps its `startTime`/`durationMin` but stops being a buffer
 *   (`isBuffer = false`) and adopts the missed block's `subjectId`/`chapterId`. The original
 *   missed block is then removed. Because the buffer already occupies a valid free-grid slot,
 *   repurposing it can never introduce an overlap, and no OTHER subject's block is touched
 *   (Req 15.2 — buffers are consumed before reducing any other subject).
 *
 *   "Compress other subjects' blocks" (Req 15.3): when no buffer fits, study blocks belonging
 *   to OTHER subjects are shrunk proportionally to their reducible capacity (never below
 *   {@link MIN_COMPRESSED_BLOCK_MIN}) to free room equal to the missed block's duration. Only
 *   durations shrink, so the no-overlap invariant is preserved. The missed block itself stays
 *   scheduled; the freed time is what lets its work be re-accommodated.
 *
 *   "Convert unused buffers" (Req 15.4/15.5): a buffer still flagged `isBuffer = true` at week
 *   end is converted to the user's chosen option. Both options consume the reservation
 *   (`isBuffer` becomes `false`); the `purpose` records whether it became CATCH_UP or
 *   EXTRA_REVISION time. This is a pure transform exposed via an end-of-week endpoint.
 */

/** Minimum duration (minutes) a study block may be compressed to — one 30-minute slot. */
export const MIN_COMPRESSED_BLOCK_MIN = 30;

/** The minimal shape of a study/buffer block the rebalancer reasons about. */
export interface RebalanceBlock {
    id: string;
    subjectId: string | null;
    chapterId: string | null;
    startTime: Date;
    durationMin: number;
    isBuffer: boolean;
}

/** A single block-compression instruction produced by {@link compressOtherSubjects}. */
export interface Compression {
    blockId: string;
    /** The block's duration after compression (≥ {@link MIN_COMPRESSED_BLOCK_MIN}). */
    newDurationMin: number;
    /** How many minutes were shaved off the original duration (> 0). */
    reducedByMin: number;
}

/**
 * The rebalancing plan for one missed block:
 *   - `BUFFER_FILL` — repurpose `bufferId` into the missed work (preferred, Req 15.2).
 *   - `COMPRESS`    — no buffer fit; shrink the listed other-subject blocks (Req 15.3).
 *   - `NONE`        — neither a buffer nor any compressible block is available.
 */
export type RebalanceDecision =
    | { strategy: 'BUFFER_FILL'; bufferId: string }
    | { strategy: 'COMPRESS'; compressions: Compression[] }
    | { strategy: 'NONE' };

/** Deterministic ordering: earliest start first, then id as a stable tie-break. */
function byStartThenId(a: RebalanceBlock, b: RebalanceBlock): number {
    const delta = a.startTime.getTime() - b.startTime.getTime();
    return delta !== 0 ? delta : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Find the earliest available `Buffer_Slot` of sufficient size remaining in the week into
 * which the missed block's work can be moved (Req 15.2).
 *
 * A buffer is a candidate when it is flagged `isBuffer`, starts at or after the missed
 * block's own start time (i.e. still lies ahead in the remaining week), and is at least as
 * long as the missed block. The earliest such buffer (by start time, id tie-break) is
 * returned, or `null` when none fits.
 */
export function findFillableBuffer(
    missed: RebalanceBlock,
    blocks: ReadonlyArray<RebalanceBlock>,
): RebalanceBlock | null {
    const candidates = blocks
        .filter(
            (block) =>
                block.isBuffer &&
                block.id !== missed.id &&
                block.startTime.getTime() >= missed.startTime.getTime() &&
                block.durationMin >= missed.durationMin,
        )
        .sort(byStartThenId);
    return candidates[0] ?? null;
}

/**
 * Compute proportional compressions of OTHER subjects' study blocks to free `neededMin`
 * minutes (Req 15.3). Each block keeps at least {@link MIN_COMPRESSED_BLOCK_MIN}; the freed
 * time is distributed in proportion to each block's reducible capacity
 * (`durationMin − minimum`). When the total reducible capacity is less than `neededMin` the
 * function frees as much as possible (best effort). Returns one {@link Compression} per block
 * that is actually shrunk, in deterministic order. Pure: inputs are never mutated.
 */
export function compressOtherSubjects(
    neededMin: number,
    compressible: ReadonlyArray<RebalanceBlock>,
    minBlockMin: number = MIN_COMPRESSED_BLOCK_MIN,
): Compression[] {
    if (neededMin <= 0) {
        return [];
    }
    const blocks = [...compressible].sort(byStartThenId);
    const reducible = blocks.map((block) => Math.max(0, block.durationMin - minBlockMin));
    const totalReducible = reducible.reduce((sum, capacity) => sum + capacity, 0);
    if (totalReducible <= 0) {
        return [];
    }

    const target = Math.min(neededMin, totalReducible);
    const reductions = reducible.map((capacity) =>
        Math.floor((target * capacity) / totalReducible),
    );

    // Distribute the rounding remainder one minute at a time to blocks with spare capacity.
    let freed = reductions.reduce((sum, amount) => sum + amount, 0);
    let cursor = 0;
    let guard = 0;
    const guardLimit = (target - freed) * blocks.length + blocks.length + 1;
    while (freed < target && guard < guardLimit) {
        if (reductions[cursor] < reducible[cursor]) {
            reductions[cursor] += 1;
            freed += 1;
        }
        cursor = (cursor + 1) % blocks.length;
        guard += 1;
    }

    const compressions: Compression[] = [];
    for (let i = 0; i < blocks.length; i += 1) {
        const reducedByMin = reductions[i];
        if (reducedByMin > 0) {
            compressions.push({
                blockId: blocks[i].id,
                newDurationMin: blocks[i].durationMin - reducedByMin,
                reducedByMin,
            });
        }
    }
    return compressions;
}

/**
 * Decide how to rebalance a single missed study block (Req 15.2/15.3). A fitting buffer is
 * ALWAYS preferred (`BUFFER_FILL`) before any other subject is touched; only when no buffer
 * fits are other subjects' blocks compressed (`COMPRESS`). When neither is possible the plan
 * is `NONE`. Pure and deterministic.
 *
 * "Other subjects' blocks" are non-buffer study blocks (excluding the missed block itself)
 * whose `subjectId` differs from the missed block's subject — compressing them never reduces
 * the missed block's own subject allocation.
 */
export function planRebalance(
    missed: RebalanceBlock,
    blocks: ReadonlyArray<RebalanceBlock>,
): RebalanceDecision {
    const buffer = findFillableBuffer(missed, blocks);
    if (buffer) {
        return { strategy: 'BUFFER_FILL', bufferId: buffer.id };
    }

    const otherSubjectBlocks = blocks.filter(
        (block) =>
            !block.isBuffer &&
            block.id !== missed.id &&
            block.subjectId !== missed.subjectId,
    );
    const compressions = compressOtherSubjects(missed.durationMin, otherSubjectBlocks);
    if (compressions.length > 0) {
        return { strategy: 'COMPRESS', compressions };
    }
    return { strategy: 'NONE' };
}

/** The two buffer-conversion policies a user may choose (Req 15.4). */
export const BUFFER_POLICIES = ['CATCH_UP', 'EXTRA_REVISION'] as const;

/** A user's chosen unused-buffer conversion policy. */
export type BufferPolicy = (typeof BUFFER_POLICIES)[number];

/** Type guard: is `raw` one of the two valid {@link BufferPolicy} values? */
export function isBufferPolicy(raw: unknown): raw is BufferPolicy {
    return typeof raw === 'string' && (BUFFER_POLICIES as readonly string[]).includes(raw);
}

/**
 * Validate an arbitrary input into a {@link BufferPolicy}, returning `null` for any value
 * outside the allowed set so the caller can answer `422` (Req 15.4).
 */
export function parseBufferPolicy(raw: unknown): BufferPolicy | null {
    return isBufferPolicy(raw) ? raw : null;
}

/** The converted form of a previously-unused buffer slot (Req 15.5). */
export interface BufferConversion {
    /** The original buffer block's id. */
    blockId: string;
    /** Always `false`: the reservation has been consumed by the conversion. */
    isBuffer: false;
    /** Which option the buffer was converted to, per the user's policy. */
    purpose: BufferPolicy;
}

/**
 * Convert each unused buffer slot to the user's chosen option (Req 15.5). Every input is
 * treated as an unused buffer at week end and is converted: the reservation is consumed
 * (`isBuffer` → `false`) and tagged with the chosen `purpose` (CATCH_UP or EXTRA_REVISION).
 * Pure: returns one conversion per input buffer in input order, mutating nothing.
 */
export function convertUnusedBuffers(
    buffers: ReadonlyArray<RebalanceBlock>,
    policy: BufferPolicy,
): BufferConversion[] {
    return buffers.map((buffer) => ({
        blockId: buffer.id,
        isBuffer: false,
        purpose: policy,
    }));
}
