# anthropic — Anti-Patterns

Common mistakes to avoid when working with the Anthropic SDK.

---

## Hardcoding API Keys

**Problem**: API keys committed to source code or hardcoded in files

**Fix**: Use environment variables; the SDK reads `ANTHROPIC_API_KEY` automatically

**Example**:
```
// Bad: hardcoded key
const client = new Anthropic({ apiKey: 'sk-ant-...' });

// Good: environment variable (auto-read)
const client = new Anthropic();
// Or explicit env var
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

---

## Ignoring stop_reason

**Problem**: Assuming the response is always complete text

**Fix**: Check `stop_reason` to handle `tool_use`, `max_tokens`, and `end_turn` differently

**Example**:
```
// Bad: always reading text
const text = response.content[0].text;

// Good: handle different stop reasons
if (response.stop_reason === 'tool_use') {
  const toolBlock = response.content.find(b => b.type === 'tool_use');
  // Handle tool call
} else if (response.stop_reason === 'max_tokens') {
  // Response was truncated, may need continuation
} else {
  const text = response.content[0].text;
}
```

---

## Not Handling Rate Limits

**Problem**: Crashing on 429 errors instead of retrying

**Fix**: The SDK has built-in retry logic, but configure it appropriately

**Example**:
```
// Bad: no retry handling
const client = new Anthropic();

// Good: configure retries
const client = new Anthropic({
  maxRetries: 3, // SDK retries with exponential backoff
});

// Or handle manually for custom logic
try {
  const msg = await client.messages.create({ ... });
} catch (err) {
  if (err.status === 429) {
    const retryAfter = err.headers?.['retry-after'];
    await sleep(retryAfter * 1000);
    // Retry
  }
}
```

---
