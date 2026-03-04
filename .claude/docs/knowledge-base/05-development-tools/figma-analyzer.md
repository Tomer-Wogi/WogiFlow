# Figma Integration

Match Figma designs to existing components for faster design-to-code workflows.

---

## Purpose

When implementing designs:
1. **Find Existing Components**: Don't recreate what exists
2. **Identify Variants**: Suggest variants over new components
3. **Generate Implementation Code**: Create production-ready code from designs

---

## How It Works

WogiFlow integrates with Figma through two mechanisms:

### 1. Figma MCP Server (Claude Code Integration)

When the Figma MCP server is connected to Claude Code, you can work with Figma designs directly through Claude Code's built-in Figma tools:

- `get_design_context` — Extract design data including code, screenshots, and hints
- `get_screenshot` — Capture visual screenshots of Figma frames
- `get_metadata` — Get design metadata and structure
- `get_figjam` — Read FigJam boards

### 2. WogiFlow Figma Skill

The `figma-analyzer` skill (installed by default) provides component matching:

```
Figma Design
      |
1. Extract design metadata (component names, props, styles)
2. Match against codebase (name similarity, prop compatibility)
3. Score matches (exact: 95+, strong: 80-95, variant: 60-80, new: <60)
4. Generate recommendations (use existing, add variant, create new)
```

---

## Usage

### Via Figma MCP (Recommended)

Share a Figma URL in Claude Code. The Figma MCP tools handle extraction automatically:

```
figma.com/design/<fileKey>/<fileName>?node-id=<nodeId>
```

WogiFlow's skill system enhances the MCP output by matching extracted components against your existing codebase registries.

### Via CLI

```bash
flow figma analyze <figma-data.json>   # Full pipeline: extract + match
flow figma scan                         # Scan codebase for components
flow figma extract <file>              # Extract Figma design data
```

### Via Skill Triggers

The following skill triggers are available when `figma-analyzer` is installed. These are invoked internally by WogiFlow during task execution — not as user-facing slash commands:

| Skill Trigger | Purpose |
|--------------|---------|
| `figma:implement-design` | Translate Figma designs into production-ready code |
| `figma:code-connect-components` | Connect Figma components to code via Code Connect |
| `figma:create-design-system-rules` | Generate design system rules for your codebase |

---

## Match Scores

| Score | Classification | Action |
|-------|---------------|--------|
| 95+ | Exact Match | Use as-is |
| 80-95 | Strong Match | Minor tweaks needed |
| 60-80 | Variant Candidate | Add variant |
| <60 | No Match | Create new |

---

## Component Indexing

The figma analyzer uses the component registry for matching:

```bash
# Ensure index is current before analysis
/wogi-map-index scan
```

### What's Indexed

- Component names
- Exported props
- Variants available
- File locations

---

## Best Practices

1. **Index First**: Run `/wogi-map-index scan` before analysis
2. **Name Consistency**: Use same names in Figma and code
3. **Use Variants**: Add variants instead of new components
4. **Review Matches**: Don't blindly trust scores
5. **Update App-Map**: Register new components after creation

---

## Related

- [Component Indexing](../01-setup-onboarding/component-indexing.md)
- [Task Execution](../02-task-execution/) - Using generated prompts
- [Configuration](../configuration/all-options.md) - All settings
