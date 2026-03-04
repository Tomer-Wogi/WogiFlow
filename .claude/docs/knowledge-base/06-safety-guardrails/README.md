# Safety & Guardrails

Protecting your codebase from mistakes.

---

## Overview

Safety features prevent:
- Accidental destructive changes
- Security vulnerabilities
- Lost work
- Unreviewed commits

---

## Features

| Feature | Purpose |
|---------|---------|
| [Damage Control](./damage-control.md) | Pattern-based protection |
| [Security Scanning](./security-scanning.md) | Pre-commit security checks |
| [Checkpoint/Rollback](./checkpoint-rollback.md) | Recovery system |
| [Commit Gates](./commit-gates.md) | Approval workflow |
| [Project Audit](./project-audit.md) | 7-dimension deep project analysis |

---

## Quick Start

### Enable Damage Control

```json
{
  "damageControl": {
    "enabled": true,
    "onBlock": "error"
  }
}
```

### Enable Security Scanning

```json
{
  "security": {
    "scanBeforeCommit": true,
    "blockOnHigh": true
  }
}
```

### Enable Checkpoints

```json
{
  "checkpoint": {
    "enabled": true,
    "interval": 5
  }
}
```

---

## Key Configuration

```json
{
  "damageControl": {
    "enabled": false,
    "patternsFile": ".workflow/damage-control.yaml",
    "onBlock": "error",
    "onAsk": "prompt",
    "logging": true
  },
  "security": {
    "scanBeforeCommit": true,
    "blockOnHigh": true,
    "checkPatterns": {
      "secrets": true,
      "injection": true,
      "npmAudit": true
    }
  },
  "checkpoint": {
    "enabled": true,
    "interval": 5,
    "maxCheckpoints": 20,
    "autoCommit": true
  }
}
```

---

## Protection Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    PROTECTION LAYERS                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Layer 1: Damage Control                                   │
│   ├── Block destructive commands                           │
│   ├── Require approval for risky ops                       │
│   └── Log suspicious activity                              │
│                                                             │
│   Layer 2: Security Scanning                                │
│   ├── Detect secrets in code                               │
│   ├── Find injection vulnerabilities                       │
│   └── Check npm audit                                      │
│                                                             │
│   Layer 3: Checkpoints                                      │
│   ├── Periodic snapshots                                   │
│   ├── Git commits                                          │
│   └── State backups                                        │
│                                                             │
│   Layer 4: Commit Gates                                     │
│   ├── Approval workflow                                    │
│   ├── Quality gates                                        │
│   └── Review requirements                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `flow checkpoint create` | Manual checkpoint |
| `flow checkpoint rollback` | Restore checkpoint |
| `flow checkpoint list` | View checkpoints |
| `flow security scan` | Manual security scan |

---

## Best Practices

1. **Enable Damage Control**: For production projects
2. **Regular Checkpoints**: Before risky operations
3. **Security Scan Always**: Block high-severity issues
4. **Review Before Commit**: Use approval workflow
5. **Keep Backup Checkpoints**: Don't rely on just git

---

## Related

- [Task Execution](../02-task-execution/) - Where gates apply
- [Verification](../02-task-execution/03-verification.md) - Quality gates
- [Configuration](../configuration/all-options.md) - All settings
