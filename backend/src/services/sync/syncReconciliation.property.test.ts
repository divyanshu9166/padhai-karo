import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { decideSyncAction } from './syncReconciliation';

/**
 * Property-based test for idempotent offline sync reconciliation (task 18.2).
 *
 * Exercises the pure {@link decideSyncAction} decision over a generated ledger of
 * already-synced `clientId -> serverId` plus an incoming sequence of client ids (with
 * repeats). It simulates the service fold-in (assigning a fresh server id on CREATE) to show
 * that a known client id reconciles to DUPLICATE with the existing server id while distinct
 * client ids map to distinct records. See design "Correctness Properties" → Property 47.
 *
 * Validates: Requirements 21.5
 */

// A small client-id pool so repeats and overlaps with the initial ledger occur frequently.
const clientIdArb = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
const serverIdArb = fc.string({ minLength: 1, maxLength: 8 });

describe('Property 47: Idempotent offline sync', () => {
    // Feature: jee-neet-study-app, Property 47: For any local sync record, re-syncing a record whose client identifier matches an already-synced record creates no duplicate and returns the existing server id; distinct client identifiers create distinct records.
    it('reconciles known client ids to DUPLICATE and creates distinct records for new ones', () => {
        fc.assert(
            fc.property(
                fc.dictionary(clientIdArb, serverIdArb),
                fc.array(clientIdArb, { maxLength: 24 }),
                (initialLedger, incoming) => {
                    const ledger = new Map(Object.entries(initialLedger));
                    const createdClientIds = new Set<string>();
                    const createdServerIds: string[] = [];
                    let seq = 0;

                    for (const clientId of incoming) {
                        const known = ledger.has(clientId);
                        const decision = decideSyncAction(ledger, clientId);

                        if (known) {
                            // Re-sync of a known client id: no new record, existing server id returned.
                            expect(decision).toEqual({
                                action: 'DUPLICATE',
                                serverId: ledger.get(clientId),
                            });
                        } else {
                            // Unknown client id: must create.
                            expect(decision).toEqual({ action: 'CREATE' });
                            const serverId = `srv-${seq}`;
                            seq += 1;
                            ledger.set(clientId, serverId);
                            createdClientIds.add(clientId);
                            createdServerIds.push(serverId);
                        }
                    }

                    // Distinct client ids create distinct records: each created client id was
                    // created exactly once and assigned a unique server id.
                    expect(createdServerIds).toHaveLength(createdClientIds.size);
                    expect(new Set(createdServerIds).size).toBe(createdServerIds.length);

                    // Every created client id is now idempotent: a further sync is a DUPLICATE
                    // returning the same server id (no duplicate row is ever created).
                    for (const clientId of createdClientIds) {
                        expect(decideSyncAction(ledger, clientId)).toEqual({
                            action: 'DUPLICATE',
                            serverId: ledger.get(clientId),
                        });
                    }
                },
            ),
        );
    });
});
