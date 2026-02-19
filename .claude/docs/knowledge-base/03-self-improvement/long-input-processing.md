# Long Input Processing

<!-- PINS: overview, gate-system, content-classification, processing-modes -->

A smart gate system for processing large inputs (transcripts, specs, requirements) with automatic content classification.

---

## Overview
<!-- PIN: overview -->

The Long Input Processing system automatically detects and handles large inputs using a gate mechanism that:

1. **Checks input size** against configurable thresholds
2. **Classifies content type** (transcript, spec, requirements, code)
3. **Recommends processing mode** based on content type
4. **Triggers appropriate extraction** when needed

This replaces the old `/transcript-digestion` skill with a more flexible, automatic approach.

---

## The Gate System
<!-- PIN: gate-system -->

```
User Input → Long Input Gate → Content Classification → Processing Mode
                  ↓                      ↓                    ↓
            Check thresholds      Detect type          full|quick|skip|ask
```

### Thresholds

| Metric | Default | Description |
|--------|---------|-------------|
| `charThreshold` | 2000 | Characters to trigger gate |
| `lineThreshold` | 50 | Lines to trigger gate |

### When Gate Triggers

The gate activates when input exceeds **either** threshold, then classifies content to determine action.

---

## Content Classification
<!-- PIN: content-classification -->

The system auto-detects content type using pattern matching:

| Type | Patterns Detected |
|------|-------------------|
| `transcript` | Meeting notes, speaker labels, timestamps |
| `spec` | PRD language, "must/shall/should", acceptance criteria |
| `requirements` | Feature requests, user stories, "as a...I want..." |
| `code` | Import statements, syntax patterns, file extensions |

---

## Processing Modes
<!-- PIN: processing-modes -->

| Mode | Description | When Used |
|------|-------------|-----------|
| `full` | Complete 4-pass extraction with clarifications | Transcripts, specs, requirements |
| `quick` | Fast single-pass scan | Unknown content types |
| `skip` | No extraction | Code content |
| `ask` | Prompt user to choose | When `smartDefault` is disabled |

### The 4-Pass Algorithm (Full Mode)

1. **Pass 1: Topic Extraction** - Identify distinct features/themes
2. **Pass 2: Statement Association** - Map every statement to a topic
3. **Pass 3: Orphan Check** - Find unmapped statements, ensure 100% coverage
4. **Pass 4: Contradiction Resolution** - Detect mind-changes, ask for clarification

---

## Configuration

```json
{
  "longInputGate": {
    "enabled": true,
    "charThreshold": 2000,
    "lineThreshold": 50,
    "smartDefault": true,
    "contentRules": {
      "transcript": "full",
      "spec": "full",
      "requirements": "full",
      "code": "skip",
      "default": "quick"
    },
    "supportedLanguages": ["en", "uk", "ru", "he"]
  }
}
```

---

## Integration with Voice Input

Voice recordings flow through the system as:

```
Voice Recording → Task Creation → Long Input Gate → Processing
```

Not directly to processing - the gate decides based on content.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `flow-long-input.js` | Main processing logic |
| `flow-long-input-chunking.js` | Handle large inputs via chunking |
| `flow-long-input-language.js` | Multi-language support |
| `flow-long-input-parsing.js` | VTT/SRT/transcript parsing |
| `flow-long-input-stories.js` | Story generation from extracted requirements |
| `hooks/core/long-input-gate.js` | Gate hook for automatic detection |

---

## Migration from transcript-digestion
<!-- PIN: migration -->

The old `/transcript-digestion` skill has been replaced with automatic detection:

| Old | New |
|-----|-----|
| `/transcript-digestion` command | Automatic via long-input-gate |
| `transcriptDigestion` config | `longInputGate` config |
| Skill-based invocation | Hook-based detection |
| `.claude/skills/transcript-digestion/` | (deleted) |

### Migration Steps

If upgrading from an older version:

1. **Update config**: Rename `transcriptDigestion` → `longInputGate` in `.workflow/config.json`
2. **Remove old skill**: Delete `.claude/skills/transcript-digestion/` if it exists
3. **Remove from installed**: Remove `transcript-digestion` from `skills.installed` array
4. **No action needed**: The new system is automatic - no slash command needed

### Backward Compatibility

The system will recognize the old `transcriptDigestion` config key and warn about migration, but new installations should use `longInputGate`.

---

## Related

- [Development Tools](../05-development-tools/README.md) - Available dev tools
- [Task Execution](../02-task-execution/02-execution-loop.md) - How tasks flow through gates

---

Last updated: 2026-01-14
