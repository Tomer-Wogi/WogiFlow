---
name: figma-analyzer
version: 1.0.0
description: Analyze Figma designs and match components against existing codebase
scope: project
user-invocable: true
context: inline
agent: developer
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash(./scripts/flow figma *)
  - mcp__figma__*
lastUpdated: 2026-01-11
learningCount: 0
successRate: 0
---

# Figma Component Analyzer Skill

## Overview

This skill helps you analyze Figma designs and match components against the existing codebase. Instead of generating all new code, it identifies what can be reused and guides developers through an interactive confirmation process.

## When to Use

Use this skill when:
- A developer shares a Figma link and asks to implement a screen
- Converting Figma designs to code
- Adding new screens/features from Figma designs
- Working with Figma MCP to generate code

## Triggers

- keywords: ["figma", "figma-link", "design-file", "design-system", "design-tokens", "mockup", "wireframe", "figma-mcp", "frame", "artboard"]
- filePatterns: []
- taskTypes: ["feature"]
- categories: ["design", "design-to-code"]

## Workflow

### Step 1: Index the Codebase (First Time)

Before analyzing Figma designs, index the codebase:

```bash
./scripts/flow figma scan
```

This creates `.workflow/state/component-registry.json` with all existing components.

### Step 2: Get Figma Data via MCP

When the developer provides a Figma link, use the Figma MCP to get design data:

```
# Use Figma MCP to get design context
figma.get_file_nodes(file_key="...", node_ids=["..."])
```

### Step 3: Analyze and Match

Use the Wogi Figma tools to analyze:

```bash
# Extract components from Figma data
echo '<figma_mcp_response>' | ./scripts/flow-figma-extract.js --stdin > /tmp/figma-components.json

# Match against registry
./scripts/flow-figma-match.js /tmp/figma-components.json > /tmp/figma-matches.json
```

Or use the MCP server tools directly:
- `wogi_figma_analyze` - Full analysis pipeline
- `wogi_figma_match` - Match single component

### Step 4: Present Results to Developer

Display the analysis results in a clear format:

```
═══════════════════════════════════════════════════════════════════
                 FIGMA COMPONENT ANALYSIS
═══════════════════════════════════════════════════════════════════

📊 Found 12 components, 8 potential matches

ATOMS (5):
├─ Icon (settings)    → 95% match → Icon.tsx           ✅ USE
├─ Text (heading)     → 100% match → Typography.tsx    ✅ USE
├─ Button (primary)   → 88% match → Button.tsx         ⚠️ ADJUST
├─ Input (outlined)   → 72% match → Input.tsx          ➕ VARIANT?
└─ Avatar (new)       → 45% match → Avatar.tsx         🆕 NEW

MOLECULES (4):
├─ SearchBar          → 92% match → SearchBar.tsx      ✅ USE
├─ Card (stats)       → 85% match → Card.tsx           ⚠️ ADJUST
├─ NavItem            → 78% match → NavItem.tsx        ➕ VARIANT?
└─ UserMenu           → 35% match → (none)             🆕 NEW

ORGANISMS (3):
├─ Header             → 82% match → Header.tsx         ⚠️ ADJUST
├─ Sidebar            → 68% match → Sidebar.tsx        ➕ VARIANT?
└─ Dashboard          → 0% match → (none)              🆕 NEW
```

### Step 5: Interactive Confirmation

For each component, ask the developer to confirm:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Sidebar (nav) - 68% match to Sidebar.tsx

Differences:
  • Width: 280px (existing: 240px)
  • Background: #1F2937 (existing: #111827)
  • Has collapse button (existing: doesn't)

Options:
  [1] ✅ Use existing Sidebar.tsx (ignore differences)
  [2] ➕ Add as variant "collapsible" to Sidebar.tsx
  [3] 🆕 Create new component: CollapsibleSidebar.tsx
  [4] ⏭️ Skip - I'll handle manually

Developer choice:
```

### Step 6: Generate Code

After all confirmations, generate the appropriate code:

```bash
./scripts/flow figma generate
```

Output includes:
- Import statements for existing components
- Variant additions (what to add to existing components)
- New component prompts for Claude to generate
- Composition code showing how everything fits together

## Key Principles

1. **Never regenerate existing components** - Always check registry first
2. **Break screens into atoms first** - Work bottom-up
3. **80% threshold for reuse** - Below 80% match, consider creating new
4. **Confirm before creating** - Let developer decide use/variant/new
5. **Preserve design system** - Match existing patterns and tokens

## Thresholds

| Score | Suggestion |
|-------|------------|
| 95%+ | Use directly |
| 80-95% | Use with minor adjustments |
| 60-80% | Consider as variant |
| <60% | Create new component |

## Files Created

- `.workflow/state/component-registry.json` - Codebase component index
- `.workflow/state/figma-decisions.json` - Developer decisions
- `.workflow/state/figma-output.json` - Generated output

## CLI Commands

```bash
./scripts/flow figma scan              # Scan codebase for components
./scripts/flow figma show [name]       # Show component details
./scripts/flow figma extract <file>    # Extract from Figma data
./scripts/flow figma match <file>      # Match against registry
./scripts/flow figma confirm <file>    # Interactive confirmation
./scripts/flow figma generate          # Generate code from decisions
./scripts/flow figma server            # Start MCP server
```

## MCP Server

Start the MCP server for use with Claude Desktop or other MCP clients:

```bash
./scripts/flow figma server
```

Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "wogi-figma": {
      "command": "node",
      "args": ["/path/to/wogi-flow/scripts/flow-figma-mcp-server.js"]
    }
  }
}
```

## Example Prompt

When a developer says "implement this Figma screen", respond:

"I'll analyze this design and match it against your existing components. Let me:

1. First, check your component registry (or scan if needed)
2. Extract all components from the Figma design
3. Match each against your codebase
4. Walk you through what to reuse vs. create new

This ensures we maintain your design system and don't duplicate components."

## Setting Up Figma MCP

To use Figma designs with Claude:

1. Get a Figma Personal Access Token from https://www.figma.com/developers/api#access-tokens
2. Add the Figma MCP server to your Claude config:

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-figma"],
      "env": {
        "FIGMA_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

3. Now you can use `figma.get_file_nodes()` to fetch design data
