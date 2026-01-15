# Feature: Claude Code Integration Improvements

## Overview
Enhance WogiFlow integration with Claude Code based on the January 2026 changelog. This feature includes documentation updates, nested skills support, status line integration, and context monitor enhancements.

## Motivation
Claude Code's January 2026 release introduced several changes that affect WogiFlow:
- **Breaking**: Removed @-mention for MCP server enable/disable
- **Opportunity**: Nested skills discovery in subdirectories
- **Opportunity**: New status line fields for context window percentage
- **Opportunity**: Native context tracking we can leverage

## Scope

### Task 1: Update MCP Documentation (P0 - Breaking Change)
Update any documentation referencing @-mention for MCP servers to use `/mcp enable <name>` instead.

### Task 2: Nested Skills Organization (P1)
Enable hierarchical skill organization for better domain separation and monorepo support.

### Task 3: Status Line Integration (P1)
Create a skill/command to configure Claude Code's status line with WogiFlow-specific information.

### Task 4: Context Monitor Enhancement (P2)
Enhance flow-context-monitor.js to optionally leverage Claude Code's native context tracking.

## Success Criteria
- All documentation updated for MCP command change
- Skills can be organized in nested directories
- Users can configure status line with task/context info
- Context monitor can use native Claude Code tracking

## Timeline
- Task 1: Immediate (documentation fix)
- Tasks 2-3: Short-term
- Task 4: Medium-term
