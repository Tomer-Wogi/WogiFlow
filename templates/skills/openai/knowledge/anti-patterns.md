# openai — Anti-Patterns

Common mistakes to avoid when working with the OpenAI SDK.

---

## Hardcoding API Keys

**Problem**: API keys committed to source code or hardcoded in files

**Fix**: Use environment variables; the SDK reads `OPENAI_API_KEY` automatically

**Example**:
```
// Bad: hardcoded key
const client = new OpenAI({ apiKey: 'sk-...' });

// Good: environment variable (auto-read)
const client = new OpenAI();
```

---

## Ignoring finish_reason

**Problem**: Assuming the response is always complete text

**Fix**: Check `finish_reason` to handle `tool_calls`, `length`, and `stop` differently

**Example**:
```
// Bad: always reading content
const text = completion.choices[0].message.content;

// Good: handle different finish reasons
const choice = completion.choices[0];
if (choice.finish_reason === 'tool_calls') {
  // Handle function calls
} else if (choice.finish_reason === 'length') {
  // Response was truncated, may need continuation
} else {
  const text = choice.message.content;
}
```

---

## Not Parsing Function Arguments Safely

**Problem**: Assuming `tool_calls[].function.arguments` is always valid JSON

**Fix**: Wrap JSON.parse in try/catch — the model can produce malformed JSON

**Example**:
```
// Bad: crashes on malformed JSON
const args = JSON.parse(toolCall.function.arguments);

// Good: safe parsing
let args;
try {
  args = JSON.parse(toolCall.function.arguments);
} catch (err) {
  console.error('Failed to parse tool arguments:', err.message);
  // Handle gracefully
}
```

---
