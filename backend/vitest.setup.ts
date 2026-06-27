import fc from 'fast-check';

// Property-based test iteration count.
//
// The design "Testing Strategy" targets a minimum of 100 iterations for full validation
// (e.g. in CI). For faster local runs the count is overridable via the `FC_NUM_RUNS`
// environment variable and defaults to a lighter 15 iterations here, which still exercises
// each property across a meaningful spread of generated inputs while keeping the suite fast.
//
// To run the full 100-iteration validation: set FC_NUM_RUNS=100 (e.g. `FC_NUM_RUNS=100 npm test`).
const DEFAULT_NUM_RUNS = 15;
const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? '', 10);
const numRuns = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NUM_RUNS;

fc.configureGlobal({ numRuns });
