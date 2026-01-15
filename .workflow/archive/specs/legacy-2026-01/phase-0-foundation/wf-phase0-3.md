# [wf-phase0-3] Variable Substitution in Config

## User Story
**As a** developer configuring wogi-flow
**I want** to use dynamic values in my config files
**So that** I can reference environment variables and external files without hardcoding secrets

## Description
Add support for variable substitution patterns in config files. This enables cleaner configuration by allowing `{env:VAR}` for environment variables and `{file:path}` for file-based secrets. This is particularly useful for API keys (following Kubernetes secrets pattern) and team-wide templates.

## Acceptance Criteria

### Scenario 1: Environment variable substitution
**Given** a config value contains `{env:ANTHROPIC_API_KEY}`
**When** the config is loaded
**Then** it should be replaced with the value of `$ANTHROPIC_API_KEY`
**And** if the env var is not set, it should remain as the placeholder

### Scenario 2: File-based substitution
**Given** a config value contains `{file:~/.secrets/api-key}`
**When** the config is loaded
**Then** it should be replaced with the contents of that file
**And** the file contents should be trimmed of whitespace
**And** if the file doesn't exist, log a warning and keep placeholder

### Scenario 3: Nested object substitution
**Given** substitution patterns exist in nested config objects
**When** the config is loaded
**Then** all nested values should be processed
**And** arrays should also be processed

### Scenario 4: Tilde expansion
**Given** a file path contains `~`
**When** the path is resolved
**Then** `~` should expand to the user's home directory
**And** `~/.secrets/key` becomes `/Users/username/.secrets/key`

### Scenario 5: Substitution in model registry
**Given** the model registry has API keys with `{env:...}` patterns
**When** making API calls
**Then** the actual API key should be used
**And** the raw config file should not contain secrets

### Scenario 6: Error handling for missing variables
**Given** a required config value uses `{env:MISSING_VAR}`
**When** the config is loaded
**Then** a warning should be logged
**And** the config should indicate the value is unresolved
**And** features depending on that value should fail gracefully

## Technical Notes

**Files to Create**:
- `.workflow/lib/config-substitution.js` - Substitution logic

**Files to Modify**:
- `scripts/flow-config-loader.js` - Use substitution when loading
- Any script that reads config directly

**Substitution Patterns**:
```javascript
const patterns = {
  env: /\{env:([^}]+)\}/g,      // {env:VAR_NAME}
  file: /\{file:([^}]+)\}/g,    // {file:path/to/file}
};

function substitute(config) {
  return JSON.parse(
    JSON.stringify(config)
      .replace(patterns.env, (_, name) => process.env[name] || `{env:${name}}`)
      .replace(patterns.file, (_, path) => readFileOrPlaceholder(path))
  );
}
```

**Example Usage**:
```json
{
  "providers": {
    "anthropic": {
      "apiKey": "{env:ANTHROPIC_API_KEY}"
    },
    "openai": {
      "apiKey": "{file:~/.secrets/openai-key}"
    }
  },
  "templates": {
    "storyFormat": "{file:.workflow/templates/story.md}"
  }
}
```

## Test Strategy
- [ ] Unit: Env var substitution works
- [ ] Unit: File substitution works with tilde expansion
- [ ] Unit: Missing values handled gracefully
- [ ] Integration: Config loads correctly with substitutions

## Dependencies
- None

## Complexity
**Low** - Simple regex-based substitution

## Out of Scope
- Encrypted secrets
- Remote secret managers (Vault, AWS Secrets Manager)
- Complex expressions or conditionals
