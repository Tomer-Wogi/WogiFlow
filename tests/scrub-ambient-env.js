'use strict';

/**
 * Test-runner preload (wired via `node --require ./tests/scrub-ambient-env.js --test ...`).
 *
 * Strips the WOGI_* path-override env vars from every test-file process so the
 * suite is HERMETIC against a developer's ambient session environment.
 *
 * Why this exists (audit 2026-05-29, P-F1 follow-up): flow-paths.js resolves the
 * project root via `WOGI_PROJECT_ROOT` (Strategy 0) and the canonical state dir
 * via `WOGI_CANONICAL_STATE_DIR`, both ahead of cwd/git discovery. Those env
 * vars are the recommended hook-startup-perf optimization for user projects — a
 * dev may set them in `.claude/settings.local.json`. But because the wogi-flow
 * test suite IS testing flow-paths/state-dir behavior, inheriting those vars
 * redirects tests' isolated tmp state to the real repo, producing false failures
 * (deferral-gate, no-defer-policy, task-boundary-reset, phase-gate, ...).
 *
 * The fix is to scrub them at the top of each test process. This does NOT affect
 * tests that legitimately spawn flow CLIs with an explicit env override (e.g.
 * the phase-gate CLI test passes `env: { WOGI_PROJECT_ROOT: tmpRoot }` to
 * execFileSync) — those child processes are spawned without this preload and so
 * keep their intentional values.
 */

delete process.env.WOGI_PROJECT_ROOT;
delete process.env.WOGI_CANONICAL_STATE_DIR;
