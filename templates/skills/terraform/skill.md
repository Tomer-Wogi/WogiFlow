---
name: terraform
version: 1.0.0
description: "Terraform IaC patterns, modules, and state management"
scope: project
user-invocable: false
context: inline
agent: developer
memory: project
license: MIT
compatibility: "Claude Code 2.1+"
source: prebuilt
prebuiltVersion: "1.0.0"
lastDocCheck: "2026-03-01"
context7: "/hashicorp/terraform"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
lastUpdated: "2026-03-01"
learningCount: 0
successRate: 0
---

# terraform Skill

Terraform IaC patterns, modules, and state management.

## Triggers

- keywords: ["terraform","hcl","resource","module","provider","state","plan","apply","variable","output"]
- filePatterns: ["*.tf","*.tfvars","terraform.tfstate","modules/**/*.tf",".terraform.lock.hcl"]
- taskTypes: ["feature","refactor"]
- categories: ["infrastructure","iac","devops"]

## When to Use

Load this skill when working with terraform in the project.
Matches files: *.tf, *.tfvars, terraform.tfstate, modules/**/*.tf, .terraform.lock.hcl

## Quick Reference

### Key Patterns
- **Module Composition**: Modules encapsulate infrastructure patterns, making them reusable and testable
- **Remote State Backend**: Remote state enables team collaboration and prevents concurrent modifications

### Common Mistakes to Avoid
- **Hardcoding Values**: Environment-specific values baked into .tf files
- **Monolithic Root Module**: Everything in a single directory with hundreds of resources

## Progressive Content

| File | When to Load |
|------|------------|
| `knowledge/patterns.md` | Starting a task with this skill |
| `knowledge/anti-patterns.md` | Reviewing code or fixing issues |
| `knowledge/conventions.md` | Writing new code |
| `knowledge/learnings.md` | Accumulated team-specific learnings |
