# [wf-e444ecc5] Add auto-generated tool documentation for MCP tools

## User Story
**As a** WogiFlow developer
**I want** auto-generated documentation for MCP tools to be included in AI context
**So that** the AI understands what tools are available and how to use them correctly

## Description
WogiFlow's `flow-skill-generator.js` generates skill documentation via Context7, but MCP tools (like memory server, context7, etc.) don't have auto-generated documentation. Crush provides tool documentation to help the LLM understand available tools. This feature adds a mechanism to scan MCP server configurations and generate tool documentation that can be injected into AI context, improving tool discovery and correct usage.

## Acceptance Criteria

### Scenario 1: Scan MCP servers for tools
**Given** MCP servers are configured in `.mcp/config.json` or Claude Code settings
**When** `flow mcp-docs scan` runs
**Then** it discovers all available MCP servers
**And** extracts tool names, descriptions, and parameters from each

### Scenario 2: Generate tool documentation
**Given** MCP server tools have been scanned
**When** `flow mcp-docs generate` runs
**Then** it creates `.workflow/state/mcp-tools.md` with tool documentation
**And** each tool includes: name, description, parameters, example usage

### Scenario 3: Include in AI context
**Given** MCP tool documentation exists
**When** a session starts or context is loaded
**Then** the tool documentation is available for context injection
**And** can be loaded via `flow context mcp-tools`

### Scenario 4: Handle missing MCP config
**Given** no MCP servers are configured
**When** `flow mcp-docs scan` runs
**Then** it shows a helpful message about configuring MCP
**And** does not error

## Technical Notes
- **Components**:
  - Create: `scripts/flow-mcp-docs.js` - MCP tool documentation generator
  - Modify: `scripts/flow-context-generator.js` - Include MCP docs in context
  - Create: `.workflow/state/mcp-tools.md` - Generated documentation
- **MCP Config locations**:
  - `~/.config/claude-code/mcp.json` (Claude Code)
  - `.mcp/config.json` (project-level)
- **Output format**:
  ```markdown
  ## MCP Tools Reference

  ### memory-server
  - **store_fact**: Store a fact in memory
    - `content` (string, required): The fact to store
    - `pins` (array): Optional tags
  ```
- **Constraints**: Must handle MCP servers that are unavailable

## Test Strategy
- [ ] Unit: Test MCP config parsing
- [ ] Unit: Test documentation generation format
- [ ] Integration: Test end-to-end with real MCP server

## Dependencies
- None (MCP servers are optional)

## Complexity
Medium - Requires understanding MCP protocol and config formats

## Out of Scope
- Automatic MCP server installation
- MCP server health monitoring
- Real-time tool capability updates
