# openai — Conventions

Naming and structural conventions for OpenAI SDK usage.

---

- Store API keys in environment variables, never in code or config files
- Use the latest model IDs: `gpt-4o` for most tasks, `gpt-4o-mini` for cost-sensitive work
- Always include a `system` message to set behavior and constraints
- Use `response_format: { type: 'json_schema' }` when you need structured output
- Handle all `finish_reason` values: `stop`, `tool_calls`, `length`, `content_filter`
- Use streaming for user-facing applications to reduce perceived latency
- Wrap API calls in try/catch for network and rate limit errors
- Use `client.chat.completions.create()` — the older `client.completions.create()` is legacy

---

_Customize these conventions based on your team's preferences._
