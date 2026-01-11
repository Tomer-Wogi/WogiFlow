# Trade-offs

Every configuration decision in WogiFlow involves trade-offs. Understanding these helps you tune the system for your specific needs.

---

## The Fundamental Trade-off

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     THOROUGHNESS  ◀──────────────────────▶  SPEED/COST     │
│                                                             │
│   More loops                          Fewer loops           │
│   Stricter gates                      Looser gates          │
│   Full Claude                         Hybrid mode           │
│   All verifications                   Manual verification   │
│                                                             │
│   = Higher quality                    = Lower cost          │
│   = More tokens                       = Faster              │
│   = Slower                            = More risk           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Loop Configuration Trade-offs

### `loops.enforced`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Guaranteed completion of all criteria | Can get stuck on edge cases |
| `false` | Manual control over exit | May exit prematurely |

**Recommendation**: Keep `true` for production work. Set `false` only for exploration.

### `loops.maxRetries`

| Value | Pros | Cons |
|-------|------|------|
| Higher (10+) | More attempts = higher success rate | More tokens if stuck |
| Lower (3-5) | Fails fast on impossible criteria | May miss fixable issues |

**Recommendation**: 5 is a good balance. Increase for complex verification.

### `loops.maxIterations`

| Value | Pros | Cons |
|-------|------|------|
| Higher (30+) | Handles complex multi-step tasks | Can consume many tokens |
| Lower (10-15) | Bounded cost | May not complete complex tasks |

**Recommendation**: 20 for most tasks. Increase for decomposed stories.

---

## Enforcement Trade-offs

### `enforcement.strictMode`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Every task is planned and tracked | Overhead for simple changes |
| `false` | Quick ad-hoc changes possible | May lose track of work |

**Recommendation**: Keep `true`. The planning overhead prevents costly rework.

### `enforcement.requireStoryForMediumTasks`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Forces upfront planning | Slower to start |
| `false` | Can dive into medium tasks | May miss edge cases |

**Recommendation**: Keep `true`. Stories catch scope issues early.

### `enforcement.requirePatternCitation`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Ensures consistency with decisions.md | More overhead per file |
| `false` | Faster implementation | May deviate from patterns |

**Recommendation**: Enable for large teams. Optional for solo work.

---

## Hybrid Mode Trade-offs

### Token Savings vs Quality

| Mode | Token Cost | Quality | Speed |
|------|-----------|---------|-------|
| Claude Only | 100% | Highest | Fast |
| Hybrid (Local) | 5-15% | Good* | Depends on hardware |
| Hybrid (Cloud) | 20-40% | Good | Fast |

*Quality varies significantly by local model.

### When to Use Hybrid

**Use Hybrid:**
- Boilerplate code (CRUD, forms, tests)
- Well-defined patterns
- Component variants
- Documentation

**Use Claude:**
- Complex logic
- Architecture decisions
- Debugging
- Novel implementations

### `hybrid.settings.autoExecute`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Faster execution | No review before changes |
| `false` | Review each step | Slower, more involvement |

**Recommendation**: Start with `false`. Enable `true` once confident.

---

## Quality Gate Trade-offs

### Required Gates

| More Gates | Fewer Gates |
|------------|-------------|
| Higher quality output | Faster completion |
| Catches more issues | More manual checking needed |
| Slower feedback loop | Quicker iteration |

### Example Configurations

**High Quality (Production):**
```json
{
  "qualityGates": {
    "feature": {
      "require": ["tests", "lint", "typecheck", "appMapUpdate", "requestLogEntry", "review"]
    }
  }
}
```

**Fast Iteration (Prototyping):**
```json
{
  "qualityGates": {
    "feature": {
      "require": ["lint"],
      "optional": ["tests", "review"]
    }
  }
}
```

---

## Verification Trade-offs

### `loops.autoInferVerification`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Automatic verification | May miss nuanced criteria |
| `false` | Human verification | Slower, manual work |

**Recommendation**: Keep `true`. Falls back to manual for complex criteria.

### `loops.fallbackToManual`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Never blocks on unverifiable criteria | Requires human input |
| `false` | Fully automated | May fail on valid work |

**Recommendation**: Keep `true` unless fully automated pipeline.

---

## Regression Testing Trade-offs

### `regressionTesting.sampleSize`

| Value | Pros | Cons |
|-------|------|------|
| Higher (10+) | More confidence in stability | Slower completion |
| Lower (3-5) | Faster feedback | May miss regressions |

**Recommendation**: 3-5 for normal work. Increase before releases.

### `regressionTesting.onFailure`

| Value | Behavior | Use Case |
|-------|----------|----------|
| `warn` | Shows warning, continues | Development |
| `block` | Blocks completion | Pre-release |
| `fix` | Attempts fix automatically | CI/CD |

---

## Durable Session Trade-offs

### `durableSteps.enabled`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Crash recovery, progress tracking | Slight overhead |
| `false` | Simpler execution | Lost progress on crash |

**Recommendation**: Always `true`. The overhead is minimal.

### `suspension.pollIntervalSeconds`

| Value | Pros | Cons |
|-------|------|------|
| Lower (30) | Faster resume when condition met | More polling overhead |
| Higher (300) | Less overhead | Slower to detect condition |

**Recommendation**: 60 seconds is a good balance.

---

## Parallel Execution Trade-offs

### `parallel.autoExecute`

| Value | Pros | Cons |
|-------|------|------|
| `true` | Automatic parallelization | Complex merge conflicts |
| `false` | Review before parallel | Slower to start |

**Recommendation**: Keep `false` until comfortable with worktree workflow.

### `parallel.maxConcurrent`

| Value | Pros | Cons |
|-------|------|------|
| Higher (5+) | Maximum throughput | Harder to review |
| Lower (2-3) | Manageable review | Less parallelization |

**Recommendation**: Start with 2-3. Increase as you learn the workflow.

---

## Configuration Profiles

### Maximum Quality

```json
{
  "enforcement": { "strictMode": true, "requirePatternCitation": true },
  "loops": { "enforced": true, "maxRetries": 10, "maxIterations": 30 },
  "qualityGates": {
    "feature": { "require": ["tests", "lint", "typecheck", "review"] }
  },
  "regressionTesting": { "sampleSize": 10, "onFailure": "block" },
  "hybrid": { "enabled": false }
}
```

### Maximum Speed

```json
{
  "enforcement": { "strictMode": false },
  "loops": { "enforced": false, "maxRetries": 3 },
  "qualityGates": {
    "feature": { "require": ["lint"] }
  },
  "regressionTesting": { "enabled": false },
  "hybrid": { "enabled": true, "settings": { "autoExecute": true } }
}
```

### Balanced (Recommended)

```json
{
  "enforcement": { "strictMode": true },
  "loops": { "enforced": true, "maxRetries": 5, "maxIterations": 20 },
  "qualityGates": {
    "feature": { "require": ["tests", "lint", "typecheck"] }
  },
  "regressionTesting": { "sampleSize": 3, "onFailure": "warn" },
  "hybrid": { "enabled": true, "settings": { "autoExecute": false } }
}
```

---

## Cost Estimation

### Token Usage by Configuration

| Configuration | Tokens per Task | Cost (Claude Opus) |
|--------------|-----------------|-------------------|
| Maximum Quality | 50-100k | ~$1.50-3.00 |
| Balanced | 20-50k | ~$0.60-1.50 |
| Maximum Speed | 5-15k | ~$0.15-0.45 |
| Hybrid + Balanced | 5-10k | ~$0.15-0.30 |

*Estimates based on typical medium-complexity tasks.*

### Monthly Projections

| Tasks/Day | Max Quality | Balanced | Hybrid |
|-----------|-------------|----------|--------|
| 5 | $225-450/mo | $90-225/mo | $22-45/mo |
| 10 | $450-900/mo | $180-450/mo | $45-90/mo |
| 20 | $900-1800/mo | $360-900/mo | $90-180/mo |

---

## Decision Framework

### Questions to Ask

1. **What's the cost of a bug?** High cost → More thoroughness
2. **How often do you iterate?** Rapid iteration → Fewer gates
3. **How experienced is the team?** New team → More enforcement
4. **Is this greenfield or legacy?** Legacy → More regression testing
5. **What's your token budget?** Limited → Consider hybrid

### Quick Reference

| Priority | Configuration |
|----------|--------------|
| Quality over speed | Max enforcement, more loops |
| Speed over quality | Fewer gates, hybrid mode |
| Cost efficiency | Hybrid mode, fewer retries |
| Team consistency | Pattern citation, more gates |

---

## Related

- [Execution Loop](./02-execution-loop.md) - How loops work
- [Verification](./03-verification.md) - Quality gate details
- [Configuration Reference](../configuration/all-options.md) - All options
