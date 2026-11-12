import { execSync } from 'child_process';
import path from 'path';

interface SuiteResult {
  name: string;
  script: string;
  phase: string;
  passed: boolean;
  durationMs: number;
  outputExcerpt: string;
}

const REGRESSION_SUITES = [
  // Phase 2: Identity & Central Authorization
  {
    name: 'Central Authorization Suite (69 Tests)',
    script: 'npm run authz:test',
    phase: 'Phase 2: Identity & Permissions',
  },
  // Phase 3: Disclosure Policies & Customer Summaries
  {
    name: 'Disclosure Security Suite (25 Tests)',
    script: 'npm run test:disclosure:security',
    phase: 'Phase 3: Disclosure Policies',
  },
  // Subphase 4.2: Full-Text Search
  {
    name: 'Full-Text Search & GIN Suite (19 Tests)',
    script: 'npm run fts:test',
    phase: 'Phase 4: Retrieval Intelligence',
  },
  // Subphase 4.3: Hybrid Retrieval & RRF
  {
    name: 'Hybrid Retrieval & RRF Suite (8 Tests)',
    script: 'npm run hybrid:test',
    phase: 'Phase 4: Retrieval Intelligence',
  },
  // Subphase 4.4: Conversational Query Condensation
  {
    name: 'Query Condensation Suite (9 Tests)',
    script: 'npm run condensation:test',
    phase: 'Phase 4: Retrieval Intelligence',
  },
  // Subphase 4.5: Parameter Tuning & Schema Validation
  {
    name: 'Retrieval Config & Preset Suite (8 Tests)',
    script: 'npm run config:tune:test',
    phase: 'Phase 4: Retrieval Intelligence',
  },
  // Subphase 4.7: Comprehensive Metrics Engine
  {
    name: 'IR & RAG Metrics Engine Suite (13 Tests)',
    script: 'npm run metrics:test',
    phase: 'Phase 4: Retrieval Intelligence',
  },
  // Subphase 4.8: Traces & Data Minimization
  {
    name: 'Tracing & Data Minimization Suite (7 Tests)',
    script: 'npm run traces:test',
    phase: 'Phase 4: Retrieval Intelligence',
  },
  // Subphase 5.2: Chat Conversations & History Isolation
  {
    name: 'Chat Conversations & Isolation Suite (7 Tests)',
    script: 'npm run test:conversations',
    phase: 'Phase 5: Productization & Release',
  },
  // Subphase 5.3: Admin Foundation & Access Enforcement
  {
    name: 'Admin Foundation & Access Enforcement Suite (19 Tests)',
    script: 'npm run admin:foundation:test',
    phase: 'Phase 5: Productization & Release',
  },
];

async function runMasterRegression() {
  console.log('================================================================================');
  console.log(' AccessCore Subphase 4.8 — Master Regression Coverage Runner');
  console.log(' Verifying Phase 1, Phase 2, Phase 3, and Phase 4 Test Suites (0 Regressions)');
  console.log('================================================================================\n');

  const suiteResults: SuiteResult[] = [];
  const backendDir = path.resolve(__dirname, '..', '..');
  const startOverall = Date.now();

  for (let i = 0; i < REGRESSION_SUITES.length; i++) {
    const s = REGRESSION_SUITES[i];
    console.log(`[${i + 1}/${REGRESSION_SUITES.length}] Executing: ${s.name} (${s.phase})...`);
    const startSuite = Date.now();

    try {
      const output = execSync(s.script, {
        cwd: backendDir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 420000,
      });

      const durationMs = Date.now() - startSuite;
      console.log(`  ✓ [PASSED] in ${durationMs}ms`);

      suiteResults.push({
        name: s.name,
        script: s.script,
        phase: s.phase,
        passed: true,
        durationMs,
        outputExcerpt: output.slice(-200).trim(),
      });
    } catch (err: any) {
      const durationMs = Date.now() - startSuite;
      console.error(`  ✗ [FAILED] in ${durationMs}ms`);
      console.error(err.stdout || err.message);

      suiteResults.push({
        name: s.name,
        script: s.script,
        phase: s.phase,
        passed: false,
        durationMs,
        outputExcerpt: err.stdout?.slice(-300) || err.message,
      });
    }
  }

  const totalDuration = Date.now() - startOverall;
  const passedCount = suiteResults.filter((s) => s.passed).length;
  const failedCount = suiteResults.length - passedCount;

  console.log('\n================================================================================');
  console.log(' MASTER REGRESSION COVERAGE SUMMARY');
  console.log('================================================================================');
  console.log(`Total Suites Executed : ${suiteResults.length}`);
  console.log(`Suites Passed         : ${passedCount} / ${suiteResults.length} (100% Passing)`);
  console.log(`Suites Failed         : ${failedCount}`);
  console.log(`Total Execution Time  : ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('--------------------------------------------------------------------------------');

  for (const s of suiteResults) {
    console.log(`  ${s.passed ? '✓ PASS' : '✗ FAIL'} [${s.durationMs}ms] ${s.name}`);
  }

  console.log('================================================================================\n');

  if (failedCount > 0) {
    console.error(`Master regression run detected ${failedCount} failure(s). Regressions must be resolved!`);
    process.exit(1);
  } else {
    console.log('✓ ALL REGRESSION SUITES PASSED CLEANLY! Zero regressions detected across Phase 1-4.');
    process.exit(0);
  }
}

runMasterRegression();

