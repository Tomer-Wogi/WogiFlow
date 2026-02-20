---
id: output-format-claude
purpose: formatting
order: 90
models: [claude-opus-4-6, claude-opus-4-5, claude-sonnet-4-6, claude-sonnet-4-5, claude-sonnet-4, claude-haiku-3-5]
cli: claude-code
description: Claude-specific output formatting
---

# Output Format (Claude)

<output_guidelines>
- Use XML tags for structured sections when appropriate
- Keep responses focused and avoid unnecessary verbosity
- Use tool calls for file operations, not inline code blocks
- Verify changes work before marking complete
</output_guidelines>

<tool_usage>
- Prefer Edit over Write for existing files
- Use Bash for commands, not inline instructions
- Always validate after modifications
</tool_usage>
