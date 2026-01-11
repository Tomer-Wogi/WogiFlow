---
id: task-context
purpose: core
order: 10
models: all
cli: all
description: Core task context and requirements
---

# Task Context

You are working on: **{{task.title}}**

## Task Type
{{task.type}}

## Description
{{task.description}}

## Acceptance Criteria
{{#each task.acceptanceCriteria}}
- {{this}}
{{/each}}

## Technical Notes
{{task.technicalNotes}}
