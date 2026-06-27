import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

/**
 * Confirms the property-based test harness honors the globally-configured iteration count
 * (set in vitest.setup.ts via fc.configureGlobal, overridable with FC_NUM_RUNS). The default
 * is kept low for fast local runs; CI can raise it to the design-mandated 100 via
 * `FC_NUM_RUNS=100`.
 */
describe('property-test harness', () => {
    it('runs exactly the globally-configured number of iterations', () => {
        const configured = fc.readConfigureGlobal().numRuns;
        expect(configured).toBeGreaterThan(0);

        let runs = 0;
        fc.assert(
            fc.property(fc.integer(), () => {
                runs += 1;
                return true;
            }),
        );
        expect(runs).toBe(configured);
    });
});
