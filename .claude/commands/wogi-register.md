---
description: "Register Claude Code plugins for /wogi-start routing"
allowed-tools: "Read,Glob,Grep,WebSearch,WebFetch,Edit,Write,Bash,Agent,ToolSearch,ListMcpResourcesTool,ReadMcpResourceTool,AskUserQuestion"
user-invocable: true
---

# /wogi-register — Plugin Registration

Register Claude Code plugins so that `/wogi-start` can automatically route requests to them.

## Usage

```
/wogi-register <plugin-name>     Register a new plugin (auto-discover capabilities)
/wogi-register --list            List all registered plugins
/wogi-register --remove <name>   Remove a registered plugin
```

## How It Works

When you run `/wogi-register <plugin-name>`, the system:

1. **Inspects MCP tools** matching the plugin name (most reliable)
2. **Searches online** for the plugin's documentation and capabilities
3. **Generates a plugin entry** with triggers, capabilities, and invocation details
4. **Saves to registry** at `.workflow/state/plugin-registry.json`
5. **Displays summary** of discovered capabilities for confirmation

After registration, `/wogi-start` will automatically route matching requests to the plugin.

## Registration Flow

### Step 1: MCP Tool Discovery

First, try to discover the plugin's capabilities through MCP tools:

1. Run `node scripts/flow-plugin-registry.js scan` to check for unregistered MCP servers
2. Use `ToolSearch` to search for tools matching the plugin name pattern
3. Use `ListMcpResourcesTool` to check for MCP resources from matching servers
4. Extract: tool names, descriptions, input schemas
5. Map each tool to a capability entry

### Step 2: Web Search Discovery (if MCP insufficient)

If MCP inspection yields few or no results:

1. Search for `"<plugin-name> Claude Code plugin capabilities"`
2. Search for `"<plugin-name> Claude Code MCP tools"`
3. Search for the plugin's documentation page
4. Extract capabilities from documentation
5. Generate trigger phrases from discovered capabilities

### Step 3: Build Plugin Entry

From the discovered information, construct:

```json
{
  "name": "<plugin-name>",
  "description": "Human-readable description of the plugin",
  "source": "mcp|web-discovered|manual",
  "triggers": ["phrase 1", "phrase 2"],
  "capabilities": [
    {
      "action": "action-name",
      "description": "What this action does",
      "triggerPhrases": ["send to X", "push to X"],
      "mcpTool": "mcp__server__tool_name or null",
      "requiresTask": false
    }
  ],
  "metadata": {
    "mcpServer": "server name if MCP-based",
    "docsUrl": "URL to plugin docs if found",
    "version": "plugin version if known"
  }
}
```

### Step 4: User Confirmation

Display the discovered capabilities and ask for confirmation:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Plugin Registration: <plugin-name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Description: <discovered description>
Source: MCP tools | Web search | Manual

Capabilities discovered (N):
  1. <action>: <description>
     Triggers: "phrase 1", "phrase 2"
     MCP Tool: mcp__server__tool

  2. <action>: <description>
     Triggers: "phrase 3"

Trigger phrases (top-level):
  - "send to <plugin>"
  - "push to <plugin>"
  - "use <plugin>"

Does this look correct? You can adjust before saving.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 5: Save to Registry

Call `registerPlugin()` from `scripts/flow-plugin-registry.js`:

```javascript
const { registerPlugin } = require('./scripts/flow-plugin-registry');
registerPlugin({
  name: pluginName,
  description: discoveredDescription,
  source: discoverySource,
  triggers: topLevelTriggers,
  capabilities: discoveredCapabilities,
  metadata: { mcpServer, docsUrl, version }
});
```

## Re-Registration (Update)

When `/wogi-register <plugin-name>` is run for an already-registered plugin:

1. Re-discover capabilities (same flow as above)
2. Compare with existing registration
3. Display diff: new capabilities, removed capabilities, changed triggers
4. Update the existing entry (preserves registeredAt timestamp)
5. Display: `Plugin "<name>" updated. Added N capabilities, removed M.`

## --list Mode

Display all registered plugins:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Registered Plugins (N)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  figma [active]
    4 capabilities | Source: mcp
    Triggers: "send to figma", "push to figma", "create in figma"

  linear [active]
    3 capabilities | Source: web-discovered
    Triggers: "create linear issue", "sync with linear"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If no plugins registered:
```
No plugins registered. Install a Claude Code plugin and run:
  /wogi-register <plugin-name>
```

## --remove Mode

```
Removed plugin: <plugin-name>
  Was registered with N capabilities
  /wogi-start will no longer route to this plugin
```

## Important

- The system is **fully generic** — it does NOT hardcode any plugin-specific logic
- Plugin-specific knowledge is discovered at registration time, not built-in
- All trigger matching uses word overlap scoring with a 0.5 minimum threshold
- Built-in `/wogi-*` commands always take priority over plugin routing
- Plugin actions are tracked through the normal WogiFlow task system when `trackPluginActions` is enabled

## Auto-Discovery on Session Start

When `config.plugins.autoScanOnSessionStart` is true:
- The session-start hook compares available MCP servers against the registry
- New unregistered servers are auto-registered with discovered capabilities
- Previously registered servers that are no longer available are marked `inactive`
- Display: `New plugin detected: <name>. Auto-registered with N capabilities.`

Mid-session plugin installs require manual `/wogi-register <name>`.
