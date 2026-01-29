# Paid Features Archive

This directory contains features that are planned for the paid/enterprise version of WogiFlow.

## Contents

### Jira Integration (`flow-jira-integration.js`)
- Sync tasks bidirectionally between WogiFlow and Jira
- Commands: `flow jira list`, `flow jira sync`, `flow jira push`, `flow jira config`
- Requires: Jira API token and project configuration

### Linear Integration (`flow-linear-integration.js`)
- Sync tasks bidirectionally between WogiFlow and Linear
- Commands: `flow linear list`, `flow linear sync`, `flow linear push`, `flow linear config`
- Requires: Linear API token and team configuration

## Why Archived?

These integrations are fully functional but are being reserved for the paid tier because:
1. They require external API maintenance and support
2. Enterprise teams are the primary users of issue tracker integrations
3. Free tier focuses on core workflow functionality

## Restoration

To restore these features:
1. Move the files back to `scripts/`
2. Uncomment the CLI commands in `scripts/flow`
3. Update documentation

## Archived On

2026-01-29

## Status

Fully implemented, tested, ready for paid tier activation.
