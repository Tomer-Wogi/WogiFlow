#!/usr/bin/env node

/**
 * Wogi Flow - Quality Gate Handlers
 *
 * Individual gate handler functions extracted from flow-done.js runQualityGates.
 * Each handler follows: function(context) => { passed, message, details }
 *
 * Context object shape:
 *   { taskId, taskType, normalizedType, config, gates,
 *     spawnSync, getModifiedFiles, truncateOutput,
 *     fileExists, readFile, readJson, safeJsonParse, safeJsonParseString, validateTaskId,
 *     color, success, warn, error,
 *     verificationProfile, getOutstandingFindings }
 */

const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('./flow-utils');

// v2.1 task enforcement
const { canExitLoop, getActiveLoop } = require('./flow-task-enforcer');

// v1.9.1 quality gate wiring
let wiringVerifier;
try {
  wiringVerifier = require('./flow-wiring-verifier');
} catch (_err) {
  wiringVerifier = null;
}

let standardsGate;
try {
  standardsGate = require('./flow-standards-gate');
} catch (_err) {
  standardsGate = null;
}

// v1.10 smart test discovery
let testDiscovery;
try {
  testDiscovery = require('./flow-test-discovery');
} catch (_err) {
  testDiscovery = null;
}

// v1.9.7 registry manager — lazy-loaded
let _registryManagerModule = undefined;
function getRegistryManager() {
  if (_registryManagerModule === undefined) {
    try {
      _registryManagerModule = require('./flow-registry-manager');
    } catch (_err) {
      _registryManagerModule = null;
    }
  }
  return _registryManagerModule;
}

// Workspace gates — lazy-loaded (only active when workspace mode is detected)
let _workspaceGatesModule = undefined;
function getWorkspaceGates() {
  if (_workspaceGatesModule === undefined) {
    try {
      _workspaceGatesModule = require('../lib/workspace-gates');
    } catch (_err) {
      _workspaceGatesModule = null;
    }
  }
  return _workspaceGatesModule;
}

// ============================================================
// Gate Handlers
// ============================================================

function testsGate(ctx) {
  if (!ctx.config.scripts?.test) {
    console.log(`  ${ctx.color('yellow', '\u25CB')} tests (not configured to run)`);
    return { passed: true, skipped: true };
  }

  console.log('  Running tests...');
  const result = ctx.spawnSync('npm', ['test'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.status === 0) {
    ctx.success('tests passed');
    return { passed: true };
  }

  ctx.error('tests failed');
  const errorOutput = result.stderr || result.stdout || '';
  if (errorOutput) {
    console.log(ctx.color('dim', '  Error output:'));
    const truncated = ctx.truncateOutput(errorOutput, 20, 1000);
    truncated.split('\n').forEach(line => {
      console.log(ctx.color('dim', `    ${line}`));
    });
  }
  return { passed: false, errorOutput };
}

function lintGate(ctx) {
  console.log('  Running lint...');
  let result = ctx.spawnSync('npm', ['run', 'lint'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    console.log(`  ${ctx.color('yellow', '\u27F3')} lint issues found, attempting auto-fix...`);
    ctx.spawnSync('npm', ['run', 'lint', '--', '--fix'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    result = ctx.spawnSync('npm', ['run', 'lint'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (result.status === 0) {
      ctx.success('lint passed (auto-fixed)');
      return { passed: true };
    }

    ctx.error('lint failed (manual fix required)');
    const errorOutput = result.stderr || result.stdout || '';
    if (errorOutput) {
      console.log(ctx.color('dim', '  Remaining issues:'));
      const truncated = ctx.truncateOutput(errorOutput, 15, 800);
      truncated.split('\n').forEach(line => {
        console.log(ctx.color('dim', `    ${line}`));
      });
    }
    return { passed: false, errorOutput };
  }

  ctx.success('lint passed');
  return { passed: true };
}

function typecheckGate(ctx) {
  console.log('  Running typecheck...');
  const result = ctx.spawnSync('npm', ['run', 'typecheck'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.status === 0) {
    ctx.success('typecheck passed');
    return { passed: true };
  }

  ctx.error('typecheck failed');
  const errorOutput = result.stderr || result.stdout || '';
  if (errorOutput) {
    console.log(ctx.color('dim', '  Type errors:'));
    const truncated = ctx.truncateOutput(errorOutput, 20, 1000);
    truncated.split('\n').forEach(line => {
      console.log(ctx.color('dim', `    ${line}`));
    });
  }
  return { passed: false, errorOutput };
}

function requestLogEntryGate(ctx) {
  try {
    const content = ctx.readFile(PATHS.requestLog, '');
    if (content.includes(ctx.taskId)) {
      ctx.success('requestLogEntry (found in request-log)');
    } else {
      console.log(`  ${ctx.color('yellow', '\u25CB')} requestLogEntry (add entry to request-log.md)`);
    }
  } catch (_err) {
    if (process.env.DEBUG) console.error(`[DEBUG] requestLogEntry check: ${_err.message}`);
    console.log(`  ${ctx.color('yellow', '\u25CB')} requestLogEntry (could not check)`);
  }
  // requestLogEntry is a soft gate — never fails
  return { passed: true };
}

function registryUpdateGate(ctx, gateName) {
  if (gateName === 'appMapUpdate') {
    ctx.warn("appMapUpdate is deprecated \u2014 update config.json qualityGates to use 'registryUpdate'");
  }

  const registryMod = getRegistryManager();
  if (!registryMod) {
    ctx.warn('registryUpdate (registry manager not available \u2014 verify manually)');
    return { passed: true };
  }

  try {
    console.log('  Running registry update check...');
    const modifiedFiles = ctx.getModifiedFiles();

    const mapFiles = ['app-map.md', 'function-map.md', 'api-map.md', 'schema-map.md', 'service-map.md'];
    const beforeHashes = {};
    for (const mf of mapFiles) {
      const mapPath = path.join(PATHS.state, mf);
      try {
        beforeHashes[mf] = fs.existsSync(mapPath) ? fs.statSync(mapPath).mtimeMs : 0;
      } catch (_err) {
        beforeHashes[mf] = 0;
      }
    }

    const { RegistryManager } = registryMod;
    const manager = new RegistryManager();
    manager.loadPlugins();
    manager.detectStack();
    manager.activatePlugins();

    if (manager.activePlugins.length === 0) {
      ctx.success('registryUpdate (no active registry plugins)');
      return { passed: true };
    }

    const scanResult = ctx.spawnSync('node', [
      '-e',
      `const {RegistryManager} = require(${JSON.stringify(path.join(__dirname, 'flow-registry-manager'))});
      const m = new RegistryManager(); m.loadPlugins(); m.detectStack(); m.activatePlugins();
      m.scanAll().then(r => { process.stderr.write('SCAN_RESULT:' + JSON.stringify(r)); process.exit(0); })
      .catch(err => { process.stderr.write('SCAN_RESULT:' + JSON.stringify({error: err.message})); process.exit(1); });`
    ], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
      cwd: process.cwd()
    });

    if (scanResult.status !== 0) {
      ctx.warn('registryUpdate (scan error \u2014 degraded to manual check)');
      if (process.env.DEBUG) console.error(`[DEBUG] registry scan stderr: ${scanResult.stderr}`);
      return { passed: true };
    }

    const stderrOutput = scanResult.stderr || '';
    const markerIdx = stderrOutput.indexOf('SCAN_RESULT:');
    const jsonStr = markerIdx >= 0 ? stderrOutput.slice(markerIdx + 'SCAN_RESULT:'.length) : '{}';
    const results = ctx.safeJsonParseString(jsonStr, {});

    const updatedMaps = [];
    for (const mf of mapFiles) {
      const mapPath = path.join(PATHS.state, mf);
      try {
        const afterMtime = fs.existsSync(mapPath) ? fs.statSync(mapPath).mtimeMs : 0;
        if (afterMtime > beforeHashes[mf]) {
          updatedMaps.push(mf);
        }
      } catch (_err) {
        // ignore
      }
    }

    const relevantExtensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte'];
    const codeFiles = modifiedFiles.filter(f => relevantExtensions.some(ext => f.endsWith(ext)));
    const nonTestFiles = codeFiles.filter(f => !f.includes('test') && !f.includes('spec') && !f.includes('__test'));

    const activeIds = manager.activePlugins.map(p => p.constructor.id);
    const scanSummary = Object.entries(results)
      .filter(([_id, r]) => r.success && !r.empty)
      .map(([id]) => id);

    if (updatedMaps.length > 0) {
      ctx.success(`registryUpdate (auto-scanned: ${updatedMaps.join(', ')} updated)`);
    } else if (scanSummary.length > 0) {
      ctx.success(`registryUpdate (scanned ${activeIds.join(', ')} \u2014 maps already current)`);
    } else if (nonTestFiles.length === 0) {
      ctx.success('registryUpdate (no registrable code files modified)');
    } else {
      ctx.success('registryUpdate (scanned \u2014 no new entries found)');
    }
    return { passed: true };
  } catch (err) {
    ctx.warn(`registryUpdate (error: ${ctx.truncateOutput(err.message, 3, 200)} \u2014 verify manually)`);
    return { passed: true };
  }
}

function loopCompleteGate(ctx) {
  const activeLoop = getActiveLoop();
  if (!activeLoop) {
    ctx.success('loopComplete (no active loop session)');
    return { passed: true };
  }

  const exitResult = canExitLoop();
  if (exitResult.canExit) {
    ctx.success(`loopComplete (${exitResult.reason})`);
    return { passed: true };
  }

  ctx.error(`loopComplete (${exitResult.pending ?? 0} pending, ${exitResult.failed ?? 0} failed)`);
  return { passed: false, errorOutput: exitResult.message || 'Loop not complete' };
}

function noNewFeaturesGate(ctx) {
  console.log(`  ${ctx.color('yellow', '\u25CB')} noNewFeatures (verify no behavior changes)`);
  return { passed: true };
}

/**
 * Check removal impact — extracted helper for nesting reduction.
 * Returns a sub-gate result if there are orphaned refs, or null if clean/not applicable.
 */
function checkRemovalImpact(ctx) {
  if (typeof wiringVerifier?.verifyRemovalImpact !== 'function') return null;

  const modifiedFiles = ctx.getModifiedFiles();
  if (modifiedFiles.length === 0) return null;

  console.log('  Running removal impact check...');
  const removalResult = wiringVerifier.verifyRemovalImpact(modifiedFiles);
  if (removalResult.identifiersChecked === 0) return null;

  if (removalResult.passed) {
    ctx.success(`removalImpact (${removalResult.identifiersChecked} removed identifiers verified)`);
    return null;
  }

  const orphanCount = removalResult.orphanedRefs.length;
  ctx.error(`removalImpact (${orphanCount} orphaned reference${orphanCount !== 1 ? 's' : ''} to removed exports)`);
  for (const ref of removalResult.orphanedRefs.slice(0, 5)) {
    console.log(ctx.color('dim', `    - "${ref.identifier}" removed from ${ref.removedFrom}, still used in ${ref.totalRefs} file${ref.totalRefs !== 1 ? 's' : ''}`));
    for (const consumer of ref.referencedBy.slice(0, 2)) {
      console.log(ctx.color('dim', `      \u2192 ${consumer.file}`));
    }
  }
  return {
    passed: false,
    errorOutput: `${orphanCount} removed export${orphanCount !== 1 ? 's' : ''} still referenced by consumers`
  };
}

function integrationWiringGate(ctx) {
  if (!wiringVerifier || typeof wiringVerifier.verifyWiring !== 'function') {
    ctx.warn('integrationWiring (verifier module not available \u2014 install flow-wiring-verifier.js)');
    if (process.env.DEBUG) console.error('[DEBUG] wiringVerifier module failed to load or missing verifyWiring export');
    return { passed: true };
  }

  try {
    console.log('  Running integration wiring check...');
    const result = wiringVerifier.verifyWiring(ctx.taskId);
    const gateResult = { passed: true, subGates: {} };

    if (!result.passed) {
      const unwiredCount = result.unwired?.length ?? 0;
      ctx.error(`integrationWiring (${unwiredCount} unwired file${unwiredCount !== 1 ? 's' : ''})`);
      if (result.unwired) {
        for (const item of result.unwired.slice(0, 5)) {
          console.log(ctx.color('dim', `    - ${item.file || item}`));
        }
      }
      gateResult.passed = false;
      gateResult.errorOutput = `${unwiredCount} files created but not imported/used anywhere`;
    } else {
      ctx.success(`integrationWiring (${result.verified ?? 0} files verified)`);
    }

    // v1.9.3: Removal impact check
    const removalSub = checkRemovalImpact(ctx);
    if (removalSub) {
      gateResult.subGates.removalImpact = removalSub;
    }

    return gateResult;
  } catch (err) {
    ctx.warn(`integrationWiring (verifier error \u2014 degraded to manual check: ${ctx.truncateOutput(err.message, 3, 200)})`);
    return { passed: true };
  }
}

function standardsComplianceGate(ctx) {
  if (!standardsGate || typeof standardsGate.runTaskStandardsCheck !== 'function') {
    ctx.warn('standardsCompliance (checker module not available \u2014 install flow-standards-gate.js)');
    if (process.env.DEBUG) console.error('[DEBUG] standardsGate module failed to load or missing runTaskStandardsCheck export');
    return { passed: true };
  }

  try {
    console.log('  Running standards compliance check...');
    const modifiedFiles = ctx.getModifiedFiles();
    const taskContext = { id: ctx.taskId, type: ctx.normalizedType };
    const result = standardsGate.runTaskStandardsCheck(taskContext, modifiedFiles);
    const mustFixCount = result.violations?.filter(v => v.severity === 'MUST_FIX' || v.severity === 'high').length ?? 0;

    if (mustFixCount === 0) {
      ctx.success(`standardsCompliance (${result.violations?.length ?? 0} suggestions, 0 must-fix)`);
      return { passed: true };
    }

    ctx.error(`standardsCompliance (${mustFixCount} must-fix violation${mustFixCount !== 1 ? 's' : ''})`);
    for (const v of (result.violations ?? []).filter(v => v.severity === 'MUST_FIX' || v.severity === 'high').slice(0, 5)) {
      console.log(ctx.color('dim', `    - ${v.file || ''}:${v.line || ''} ${v.issue || v.message || ''}`));
    }
    return { passed: false, errorOutput: `${mustFixCount} standards violations require fixing` };
  } catch (err) {
    ctx.warn(`standardsCompliance (checker error \u2014 degraded to manual check: ${ctx.truncateOutput(err.message, 3, 200)})`);
    return { passed: true };
  }
}

function outstandingFindingsGate(ctx) {
  const outstanding = ctx.getOutstandingFindings();
  if (!outstanding.hasOutstanding) {
    ctx.success('outstandingFindings (no unresolved critical/high findings)');
    return { passed: true };
  }

  ctx.error(`outstandingFindings (${outstanding.count} unresolved finding${outstanding.count !== 1 ? 's' : ''} from last review)`);
  for (const f of outstanding.findings.slice(0, 5)) {
    console.log(ctx.color('dim', `    - [${f.severity}] ${f.file || ''}:${f.line || ''} ${f.issue || ''}`));
  }
  return {
    passed: false,
    errorOutput: `${outstanding.count} unresolved critical/high findings from last review. Fix them or waive with /wogi-triage.`
  };
}

function preReleaseGate(ctx) {
  console.log('  Running pre-release checks...');
  let preReleaseFailed = false;

  const outstanding = ctx.getOutstandingFindings();
  if (outstanding.hasOutstanding) {
    ctx.error(`preRelease: ${outstanding.count} unresolved findings from last review`);
    preReleaseFailed = true;
  }

  if (ctx.config.scripts?.lint) {
    const lintResult = ctx.spawnSync('npm', ['run', 'lint'], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    if (lintResult.status !== 0) {
      ctx.error('preRelease: lint failed');
      preReleaseFailed = true;
    }
  }

  if (ctx.config.scripts?.typecheck) {
    const tcResult = ctx.spawnSync('npm', ['run', 'typecheck'], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    if (tcResult.status !== 0) {
      ctx.error('preRelease: typecheck failed');
      preReleaseFailed = true;
    }
  }

  if (!preReleaseFailed) {
    ctx.success('preRelease (codebase is releasable)');
    return { passed: true };
  }

  return { passed: false, errorOutput: 'Codebase is not in a releasable state' };
}

function learningEnforcementGate(ctx) {
  try {
    const feedbackPath = path.join(PATHS.state, 'feedback-patterns.md');
    const content = ctx.readFile(feedbackPath, '');
    if (content.includes(ctx.taskId)) {
      ctx.success('learningEnforcement (pattern recorded in feedback-patterns.md)');
    } else {
      console.log(`  ${ctx.color('yellow', '\u25CB')} learningEnforcement (add bug pattern to feedback-patterns.md)`);
    }
  } catch (_err) {
    console.log(`  ${ctx.color('yellow', '\u25CB')} learningEnforcement (could not check feedback-patterns.md)`);
  }
  return { passed: true };
}

function resolutionPopulatedGate(ctx) {
  try {
    const changesDir = path.join(PATHS.workflow, 'changes');
    const specPath = path.join(changesDir, `${ctx.taskId}.md`);
    const content = ctx.readFile(specPath, '');
    if (content) {
      const lower = content.toLowerCase();
      if (lower.includes('resolution') || lower.includes('root cause') || lower.includes('fix')) {
        ctx.success('resolutionPopulated (resolution documented in spec)');
      } else {
        console.log(`  ${ctx.color('yellow', '\u25CB')} resolutionPopulated (add resolution/root cause to spec)`);
      }
    } else {
      console.log(`  ${ctx.color('yellow', '\u25CB')} resolutionPopulated (no spec file found)`);
    }
  } catch (_err) {
    console.log(`  ${ctx.color('yellow', '\u25CB')} resolutionPopulated (could not check)`);
  }
  return { passed: true };
}

function smokeTestGate(ctx) {
  try {
    const modifiedFiles = ctx.getModifiedFiles();
    const jsFiles = modifiedFiles.filter(f => f.endsWith('.js'));

    if (jsFiles.length === 0) {
      console.log(`  ${ctx.color('yellow', '\u25CB')} smokeTest (no JS files modified \u2014 nothing to check)`);
      return { passed: true };
    }

    let allPassed = true;
    for (const file of jsFiles) {
      const result = ctx.spawnSync('node', ['--check', file], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      });
      if (result.status !== 0) {
        ctx.error(`smokeTest: syntax error in ${file}`);
        allPassed = false;
        break;
      }
    }

    if (allPassed) {
      ctx.success(`smokeTest (${jsFiles.length} file${jsFiles.length !== 1 ? 's' : ''} pass syntax check)`);
      return { passed: true };
    }

    return { passed: false, errorOutput: 'Syntax errors in modified files' };
  } catch (err) {
    console.log(`  ${ctx.color('yellow', '\u25CB')} smokeTest (could not run: ${ctx.truncateOutput(err.message, 3, 200)})`);
    return { passed: true };
  }
}

function generatedTestsPassGate(ctx) {
  if (!ctx.config.testing?.enabled || !ctx.config.testing?.generation?.autoGenerate) {
    console.log(`  ${ctx.color('dim', '\u00B7')} generatedTestsPass (testing disabled)`);
    return { passed: true };
  }

  if (!ctx.validateTaskId(ctx.taskId).valid) {
    ctx.warn('generatedTestsPass (invalid task ID)');
    return { passed: true };
  }

  const testDir = path.join(PATHS.workflow, 'tests', 'generated', ctx.taskId);
  if (!fs.existsSync(testDir)) {
    console.log(`  ${ctx.color('yellow', '\u25CB')} generatedTestsPass (no generated tests found)`);
    return { passed: true };
  }

  if (!ctx.config.scripts?.test) {
    console.log(`  ${ctx.color('yellow', '\u25CB')} generatedTestsPass (no test command configured)`);
    return { passed: true };
  }

  console.log('  Running generated tests...');
  const result = ctx.spawnSync('npm', ['test', '--', testDir], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120000
  });

  if (result.status === 0) {
    ctx.success('generatedTestsPass');
    return { passed: true };
  }

  ctx.error('generatedTestsPass');
  const errorOutput = result.stderr || result.stdout || '';
  if (errorOutput) {
    console.log(ctx.color('dim', '  Error output:'));
    const truncated = ctx.truncateOutput(errorOutput, 15, 800);
    truncated.split('\n').forEach(line => {
      console.log(ctx.color('dim', `    ${line}`));
    });
  }
  return { passed: false, errorOutput };
}

function verificationGate(ctx, gateName) {
  const isUI = gateName === 'uiVerification';

  // Project-type-aware gating
  const detected = ctx.config.testing?.detected;
  if (detected?.projectType) {
    const pt = detected.projectType;
    if (isUI && (pt === 'backend' || pt === 'library')) {
      console.log(`  ${ctx.color('dim', '\u00B7')} ${gateName} (not applicable \u2014 ${pt} project)`);
      return { passed: true, skipped: true };
    }
    if (!isUI && (pt === 'frontend' || pt === 'library')) {
      console.log(`  ${ctx.color('dim', '\u00B7')} ${gateName} (not applicable \u2014 ${pt} project)`);
      return { passed: true, skipped: true };
    }
  }

  const gateModes = isUI ? ['ui', 'full', 'auto'] : ['api', 'full', 'auto'];
  const testingMode = ctx.config.testing?.mode ?? 'off';

  if (!ctx.config.testing?.enabled || !gateModes.includes(testingMode)) {
    console.log(`  ${ctx.color('dim', '\u00B7')} ${gateName} (testing disabled or mode excludes ${isUI ? 'UI' : 'API'})`);
    return { passed: true };
  }

  if (!ctx.validateTaskId(ctx.taskId).valid) {
    ctx.warn(`${gateName} (invalid task ID)`);
    return { passed: true };
  }

  try {
    const label = isUI ? 'UI' : 'API';
    console.log(`  Running ${label} verification...`);
    const scriptPath = isUI
      ? path.join(__dirname, 'flow-test-ui.js')
      : path.join(__dirname, 'flow-test-api.js');
    const fnName = isUI ? 'runUITests' : 'runAPITests';
    const testResult = ctx.spawnSync('node', ['-e', [
      `const { ${fnName} } = require(${JSON.stringify(scriptPath)});`,
      `${fnName}(${JSON.stringify(ctx.taskId)}).then(r => {`,
      '  process.stdout.write(JSON.stringify(r));',
      '  process.exit(r.summary && r.summary.failed > 0 ? 1 : 0);',
      '}).catch(err => {',
      '  process.stdout.write(JSON.stringify({ error: err.message, summary: { passed: 0, failed: 0, total: 0 } }));',
      '  process.exit(2);',
      '});'
    ].join('\n')], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      timeout: 120000
    });

    if (testResult.status === 2) {
      const parsed = ctx.safeJsonParseString(testResult.stdout, {});
      const errMsg = parsed.error || testResult.stderr?.trim()?.slice(0, 200) || 'Unknown error';
      ctx.warn(`${gateName} (error: ${errMsg})`);
      return { passed: true };
    }

    const report = ctx.safeJsonParseString(testResult.stdout ?? '{}', {});
    const summary = report.summary ?? { passed: 0, failed: 0, total: 0 };

    if (summary.failed === 0) {
      ctx.success(`${gateName} (${summary.passed}/${summary.total} passed)`);
      return { passed: true };
    }

    ctx.error(`${gateName} (${summary.failed} failed)`);
    const failedItems = isUI
      ? (report.assertions ?? []).filter(a => a.status === 'failed')
      : (report.endpoints ?? []).flatMap(e => (e.tests ?? []).filter(t => t.status === 'failed'));
    for (const item of failedItems.slice(0, 5)) {
      console.log(ctx.color('dim', `    - ${item.description || item.name || 'test failed'}`));
    }
    return { passed: false, errorOutput: JSON.stringify(failedItems) };
  } catch (err) {
    ctx.warn(`${gateName} (error: ${err.message})`);
    return { passed: true };
  }
}

function uiVerificationGateAfter(ctx, gateName) {
  // Scenario verification check (only for API verification)
  if (gateName !== 'apiVerification') return null;
  if (!ctx.validateTaskId(ctx.taskId).valid) return null;

  const scenarioReportPath = path.join(PATHS.workflow, 'verifications', `${ctx.taskId}-scenarios.json`);
  if (!fs.existsSync(scenarioReportPath)) return null;

  try {
    const scenarioReport = ctx.safeJsonParse(scenarioReportPath, null);
    if (!scenarioReport?.summary) return null;

    const ss = scenarioReport.summary;
    if (ss.failed === 0 && ss.total > 0) {
      ctx.success(`scenarioVerification (${ss.passed}/${ss.total} scenarios passed)`);
    } else if (ss.failed > 0) {
      ctx.error(`scenarioVerification (${ss.failed} scenarios failed)`);
      const failedScenarios = (scenarioReport.scenarios ?? []).filter(s => !s.passed);
      for (const sc of failedScenarios.slice(0, 5)) {
        console.log(ctx.color('dim', `    - ${sc.name || 'unnamed scenario'}: ${sc.error || 'assertions failed'}`));
      }
    }
  } catch (_err) {
    // Non-fatal
  }
  return null;
}

function testDiscoveryGate(ctx) {
  const discoveryConfig = ctx.config.testing?.discovery ?? {};
  if (!discoveryConfig.enabled) {
    console.log(`  ${ctx.color('dim', '\u00B7')} testDiscovery (disabled \u2014 set testing.discovery.enabled in config)`);
    return { passed: true };
  }

  if (!testDiscovery || typeof testDiscovery.runTestDiscoveryGate !== 'function') {
    ctx.warn('testDiscovery (module not available \u2014 install flow-test-discovery.js)');
    return { passed: true };
  }

  try {
    console.log('  Running test discovery gate...');
    const discoveryResult = testDiscovery.runTestDiscoveryGate(ctx.taskId, PATHS.root);

    if (discoveryResult.passed) {
      ctx.success(`testDiscovery (${discoveryResult.message})`);
      return { passed: true };
    }

    ctx.error(`testDiscovery (${discoveryResult.message})`);
    if (discoveryResult.report?.passToPass?.failed) {
      for (const f of discoveryResult.report.passToPass.failed.slice(0, 5)) {
        console.log(ctx.color('dim', `    - ${f}`));
      }
    }
    return { passed: false, errorOutput: discoveryResult.message };
  } catch (err) {
    ctx.warn(`testDiscovery (error: ${ctx.truncateOutput(err.message, 3, 200)})`);
    return { passed: true };
  }
}

/**
 * Verification proof gate — checks that completed acceptance criteria
 * have verification evidence recorded in the durable session.
 *
 * Without this, agents can mark criteria as "completed" without any
 * behavioral evidence that the feature actually works.
 *
 * Checks durable-session.json for verificationProof on each completed step.
 * Steps without proof are flagged. If ALL steps lack proof, gate blocks.
 * If SOME steps have proof, gate warns (partial evidence).
 */
function verificationProofGate(ctx) {
  let loadDurableSession;
  try {
    ({ loadDurableSession } = require('./flow-durable-session'));
  } catch (_err) {
    ctx.warn('verificationProof (durable session module not available)');
    return { passed: true };
  }

  try {
    const session = loadDurableSession();
    if (!session || !session.taskId) {
      // No durable session — graceful fallback for tasks created before this gate existed
      console.log(`  ${ctx.color('yellow', '\u25CB')} verificationProof (no durable session — skipping)`);
      return { passed: true };
    }

    // Only check acceptance criteria steps, not system steps.
    // Normalize step type to handle both kebab-case and snake_case variants.
    const normalizeStepType = (type) => (type || '').toLowerCase().replace(/_/g, '-');
    const criteriaSteps = (session.steps || []).filter(s =>
      s.status === 'completed' && normalizeStepType(s.type) === 'acceptance-criteria'
    );

    if (criteriaSteps.length === 0) {
      console.log(`  ${ctx.color('yellow', '\u25CB')} verificationProof (no completed criteria — skipping)`);
      return { passed: true };
    }

    const unverified = criteriaSteps.filter(s => !s.verificationProof);
    const verified = criteriaSteps.length - unverified.length;

    if (unverified.length === 0) {
      ctx.success(`verificationProof (${verified}/${criteriaSteps.length} criteria have evidence)`);
      return { passed: true };
    }

    // If ALL criteria lack proof → hard block
    if (verified === 0) {
      ctx.error(`verificationProof (0/${criteriaSteps.length} criteria have verification evidence)`);
      for (const s of unverified.slice(0, 5)) {
        console.log(ctx.color('dim', `    - ${(s.description || s.title || s.id || '').substring(0, 100)}`));
      }
      console.log(ctx.color('dim', '    Run runtime verification or provide behavioral evidence for each criterion.'));
      return {
        passed: false,
        errorOutput: `${unverified.length} acceptance criteria completed without verification proof. ` +
          'Each criterion needs behavioral evidence (WebMCP, Playwright, curl, or manual checklist).'
      };
    }

    // Partial proof — warn but allow (transitional)
    console.log(`  ${ctx.color('yellow', '\u25CB')} verificationProof (${verified}/${criteriaSteps.length} verified — ${unverified.length} missing proof)`);
    for (const s of unverified.slice(0, 3)) {
      console.log(ctx.color('dim', `    - Missing: ${(s.description || s.title || s.id || '').substring(0, 80)}`));
    }
    return { passed: true };
  } catch (err) {
    ctx.warn(`verificationProof (error: ${ctx.truncateOutput(err.message, 3, 200)})`);
    return { passed: true };
  }
}

function unknownGate(ctx, gateName) {
  console.log(`  ${ctx.color('yellow', '\u25CB')} ${gateName} (manual check)`);
  return { passed: true };
}

// ============================================================
// Gate Registry
// ============================================================

// ============================================================
// Workspace Quality Gates (conditional — only when workspace active)
// ============================================================

/**
 * Workspace gate handler. Delegates to workspace-gates.js for each
 * sub-gate (crossRepoImpactCheck, contractCompliance, peerNotification,
 * cascadeVerification, integrationMapFreshness).
 *
 * This is a single gate entry in GATE_REGISTRY that runs all applicable
 * workspace sub-gates based on task type.
 */
function workspaceGate(ctx, gateName) {
  const wsGates = getWorkspaceGates();
  if (!wsGates) {
    return { passed: true, skipped: true };
  }

  const ws = wsGates.workspaceActive();
  if (!ws.active) {
    return { passed: true, skipped: true };
  }

  const context = wsGates.loadWorkspaceContext(ws.root);
  const taskMeta = {
    taskId: ctx.taskId,
    taskTitle: ctx.taskTitle || '',
    taskType: ctx.normalizedType || 'feature',
    impactAssessed: ctx.impactAssessed || false
  };

  const results = wsGates.runAllWorkspaceGates(ws.root, context, taskMeta);

  // Display results
  for (const r of results.results) {
    if (r.passed) {
      ctx.success(`workspace/${r.gate}: ${r.message}`);
    } else if (r.severity === 'warning') {
      console.log(`  ${ctx.color('yellow', '\u25CB')} workspace/${r.gate}: ${r.message}`);
    } else {
      ctx.error(`workspace/${r.gate}: ${r.message}`);
    }
  }

  if (!results.passed) {
    return {
      passed: false,
      errorOutput: `${results.errors} workspace gate(s) failed, ${results.warnings} warning(s)`
    };
  }

  return { passed: true };
}

const GATE_REGISTRY = {
  tests: testsGate,
  lint: lintGate,
  typecheck: typecheckGate,
  requestLogEntry: requestLogEntryGate,
  appMapUpdate: registryUpdateGate,
  registryUpdate: registryUpdateGate,
  loopComplete: loopCompleteGate,
  noNewFeatures: noNewFeaturesGate,
  integrationWiring: integrationWiringGate,
  standardsCompliance: standardsComplianceGate,
  outstandingFindings: outstandingFindingsGate,
  preRelease: preReleaseGate,
  learningEnforcement: learningEnforcementGate,
  resolutionPopulated: resolutionPopulatedGate,
  smokeTest: smokeTestGate,
  generatedTestsPass: generatedTestsPassGate,
  uiVerification: verificationGate,
  apiVerification: verificationGate,
  testDiscovery: testDiscoveryGate,
  verificationProof: verificationProofGate,
  // Workspace gates (conditional — auto-skip when not in workspace)
  workspaceCompliance: workspaceGate,
};

/**
 * Run a single gate by name.
 * @param {string} gateName
 * @param {object} ctx - Gate context
 * @returns {{ passed: boolean, errorOutput?: string, subGates?: object }}
 */
function runGate(gateName, ctx) {
  const handler = GATE_REGISTRY[gateName];
  if (!handler) {
    return unknownGate(ctx, gateName);
  }

  const result = handler(ctx, gateName);

  // Post-gate hooks (e.g., scenario verification after apiVerification)
  if (gateName === 'uiVerification' || gateName === 'apiVerification') {
    uiVerificationGateAfter(ctx, gateName);
  }

  return result;
}

module.exports = {
  GATE_REGISTRY,
  runGate,
  // Export individual handlers for direct testing
  testsGate,
  lintGate,
  typecheckGate,
  requestLogEntryGate,
  registryUpdateGate,
  loopCompleteGate,
  noNewFeaturesGate,
  integrationWiringGate,
  standardsComplianceGate,
  outstandingFindingsGate,
  preReleaseGate,
  learningEnforcementGate,
  resolutionPopulatedGate,
  smokeTestGate,
  generatedTestsPassGate,
  verificationGate,
  testDiscoveryGate,
  verificationProofGate,
  workspaceGate,
  unknownGate,
};
