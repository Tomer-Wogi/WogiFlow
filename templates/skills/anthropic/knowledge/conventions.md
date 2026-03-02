# anthropic — Conventions

Naming and structural conventions for Anthropic SDK usage.

---

- Store API keys in environment variables, never in code or config files
- Use the latest model IDs: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`
- Set `max_tokens` explicitly — there is no default
- Use the `system` parameter for system prompts (not a system message in the messages array)
- Handle all content block types: `text`, `tool_use`, `tool_result`
- Use streaming for user-facing applications to reduce perceived latency
- Wrap API calls in try/catch for network and rate limit errors
- Use `client.messages.create()` for single responses, `client.messages.stream()` for streaming

---

_Customize these conventions based on your team's preferences._
