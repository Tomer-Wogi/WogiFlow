# Logic Adversary Persona Library

**Story**: wf-258f558c (A2, epic wf-34290000)
**Consumer**: `scripts/flow-logic-adversary.js` → `pickPersona()`, `buildAdversaryPrompt()`
**Base persona**: `.workflow/agents/logic-adversary.md`

---

## Why personas

Baseline Logic Adversary evaluates all 11 Logic Constitution principles uniformly. A persona biases attention toward a subset of principles, sharpening critique in a specific axis.

Research signal (from 25-CLI-agents comparison, epic wf-34290000): single-voice adversary misses axis-specific failures that a specialist catches. Rotating or picking a persona per task produces a diverse-enough critique pipeline *without* the cost of spawning multiple adversary passes per plan.

## Library

| Persona | File | Amplifies | Pick when |
|---|---|---|---|
| scale-skeptic | `scale-skeptic.md` | P11.4 edge cases | New hooks/workers/queues, concurrent/parallel mentions |
| security-hawk | `security-hawk.md` | P10 irreversibility, P6 | Auth, secrets, destructive ops, shell injection risk |
| simplicity-champion | `simplicity-champion.md` | P2 scope, P7 parallel abstractions | Many new files, new frameworks, "future-proof" language |
| platform-rigor | `platform-rigor.md` | P11.1 capability, P11.2 rule grounding | Hook claims, MCP, subagent, validator-governed artifacts |
| user-advocate | `user-advocate.md` | P1, P3, P8, P9 | UI/CLI/UX work, ambiguous asks, journey changes |

## Auto-pick heuristics

`pickPersona({ taskId, plan, title })` returns one of the library keys based on trigger phrases in the plan and task title. When no strong signal matches, it rotates by `taskId` hash to ensure library coverage over time.

The orchestrator may override with `opts.persona` to force a specific persona (e.g., for testing, or when the user wants a specific lens).

## Output contract

A persona does NOT change the output JSON schema. The adversary still returns the same rubric-shaped verdict object. The persona only changes which principles are examined most aggressively and which details are demanded.

Every persona defers to the base `logic-adversary.md` for:
- JSON schema
- Degraded-mode behavior
- Iteration protocol
- Honesty requirement

Personas stack ON TOP of the base persona — they don't replace it.

## Adding a new persona

1. Create `.workflow/agents/personas/<slug>.md` with: **Specialization**, **Triggers**, **Amplified principles**, **Reflex questions**, **Output** sections.
2. Add an entry to the library table above.
3. Add a case to `pickPersona()` in `scripts/flow-logic-adversary.js` with the trigger matcher.
4. Ship a test in `tests/flow-logic-adversary-personas.test.js`.
