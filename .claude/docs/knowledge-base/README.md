# WogiFlow Knowledge Base

Welcome to the comprehensive knowledge base for WogiFlow, an AI workflow framework that ensures structured, high-quality code execution.

## Quick Navigation

| Category | Purpose | Start Here |
|----------|---------|------------|
| [Setup & Onboarding](./01-setup-onboarding/) | Initial setup, codebase analysis, populating workflow files | [Installation](./01-setup-onboarding/installation.md) |
| [Task Execution](./02-task-execution/) | The `/wogi-start` pipeline - how tasks are enforced and completed | [Execution Flow](./02-task-execution/README.md) |
| [Self-Improvement](./03-self-improvement/) | How WogiFlow learns and improves over time | [Learning Overview](./03-self-improvement/README.md) |
| [Memory & Context](./04-memory-context/) | Preventing hallucinations, managing context, session persistence | [Context Management](./04-memory-context/context-management.md) |
| [Development Tools](./05-development-tools/) | Figma analyzer, code traces, MCP integrations | [Tools Overview](./05-development-tools/README.md) |
| [Safety & Guardrails](./06-safety-guardrails/) | Damage control, security scanning, checkpoint/rollback | [Safety Overview](./06-safety-guardrails/README.md) |
| [Configuration](./configuration/) | Complete reference for all 200+ config options | [All Options](./configuration/all-options.md) |
| [Future Features](./future-features.md) | Roadmap and planned features | [Roadmap](./future-features.md) |

---

## Quick Start

### Install
```bash
npm install -D wogiflow
# or
bun add -d --trust wogiflow   # --trust is required for bun to run postinstall
```

### Analyze Existing Project
```bash
npx flow onboard
```

### Start Working
```bash
/wogi-ready          # See available tasks
/wogi-start TASK-XXX # Start a task
```

---

## How This Knowledge Base Is Organized

Unlike feature-by-feature documentation, this knowledge base is organized by **purpose** - what you're trying to accomplish:

### 1. Setting Up (Once per project)
Everything in [01-setup-onboarding](./01-setup-onboarding/) helps you get WogiFlow configured for your project. This includes analyzing your codebase and populating decisions and component registries.

### 2. Executing Tasks (Daily workflow)
The [02-task-execution](./02-task-execution/) category is the heart of WogiFlow. It explains the entire execution pipeline from task selection through completion, including:
- Why task gating prevents incomplete work
- How loops ensure acceptance criteria are met
- Trade-offs between thoroughness and token consumption

### 3. Getting Smarter Over Time
[03-self-improvement](./03-self-improvement/) explains how WogiFlow learns from corrections and improves at four levels: project, skill, model, and team.

### 4. Managing Context & Memory
[04-memory-context](./04-memory-context/) addresses the biggest challenge in AI coding: context window limits and session persistence. These features prevent hallucinations and preserve history.

### 5. Accelerating Development
[05-development-tools](./05-development-tools/) covers additional tools that speed up specific workflows like design-to-code and understanding codebases.

### 6. Staying Safe
[06-safety-guardrails](./06-safety-guardrails/) documents protections against mistakes, including pattern-based damage control, security scanning, and recovery systems.

---

## Common Tasks

| I want to... | Read this |
|--------------|-----------|
| Set up WogiFlow for the first time | [Installation](./01-setup-onboarding/installation.md) |
| Understand how task execution works | [Execution Flow](./02-task-execution/README.md) |
| Configure loops and verification | [Execution Loop](./02-task-execution/02-execution-loop.md) |
| Reduce token consumption | [Trade-offs](./02-task-execution/trade-offs.md) |
| Set up hybrid mode (local LLM) | [Execution Loop](./02-task-execution/02-execution-loop.md#hybrid-mode) |
| Understand how learning works | [Self-Improvement](./03-self-improvement/README.md) |
| Fix context/hallucination issues | [Context Management](./04-memory-context/context-management.md) |
| Use Figma-to-code | [Figma Analyzer](./05-development-tools/figma-analyzer.md) |
| Set up safety guardrails | [Damage Control](./06-safety-guardrails/damage-control.md) |
| Find a specific config option | [All Options](./configuration/all-options.md) |
| Import tasks from Jira/Linear | [External Integrations](./02-task-execution/external-integrations.md) |
| Load PRD/specs for context | [PRD Management](./04-memory-context/prd-management.md) |
| Manage memory & entropy | [Memory Commands](./04-memory-context/memory-commands.md) |
| Configure multiple models | [Model Management](./02-task-execution/model-management.md) |

---

## Related Resources

- [Command Reference](../commands.md) - All slash commands
- [Main README](../../../README.md) - Project overview
- [CLAUDE.md](../../../CLAUDE.md) - Workflow methodology
