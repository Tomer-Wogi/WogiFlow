# Product Vision

<!-- PINS: product-name, target-users, core-features, value-prop, non-goals, success-metrics -->

## Overview
<!-- PIN: product-name -->
**Name**: {{productName}}
**Tagline**: {{tagline}}
**Type**: {{productType}}

## Problem & Users

### Problem Statement
<!-- PIN: problem-statement -->
{{problemStatement}}

### Target Users
<!-- PIN: target-users -->
| User Type | Description | Primary Need |
|-----------|-------------|--------------|
{{#each targetUsers}}
| {{type}} | {{description}} | {{need}} |
{{/each}}

### User Jobs-to-be-Done
<!-- PIN: user-jobs -->
{{#each userJobs}}
{{@index}}. {{this}}
{{/each}}

## Solution

### Core Value Proposition
<!-- PIN: value-prop -->
{{valueProposition}}

### Key Features
<!-- PIN: core-features -->
| Feature | Description | Priority |
|---------|-------------|----------|
{{#each features}}
| {{name}} | {{description}} | {{priority}} |
{{/each}}

### Non-Goals
<!-- PIN: non-goals -->
{{#each nonGoals}}
- {{this}}
{{/each}}

## Success

### Success Metrics
<!-- PIN: success-metrics -->
| Metric | Target | How Measured |
|--------|--------|--------------|
{{#each successMetrics}}
| {{metric}} | {{target}} | {{measurement}} |
{{/each}}

### MVP Definition
<!-- PIN: mvp -->
{{mvpDefinition}}

---
**Generated**: {{generatedAt}}
**Source**: {{source}}
**Last Updated**: {{lastUpdated}}
