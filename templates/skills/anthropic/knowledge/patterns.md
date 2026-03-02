# anthropic — Successful Patterns

Best practices for working with the Anthropic SDK and Claude API.

---

## Messages API Basic Usage

**Context**: Sending a message to Claude and getting a response

**Example**:
```
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic(); // Uses ANTHROPIC_API_KEY env var

const message = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'Explain recursion in one sentence.' }
  ]
});

console.log(message.content[0].text);
```

**Why it works**: The SDK auto-reads the API key from the environment, and the messages API uses a simple role/content structure

---

## Tool Use (Function Calling)

**Context**: Letting Claude call your functions

**Example**:
```
const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  tools: [{
    name: 'get_weather',
    description: 'Get current weather for a location',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' }
      },
      required: ['location']
    }
  }],
  messages: [{ role: 'user', content: 'What is the weather in London?' }]
});

// Handle tool use
for (const block of response.content) {
  if (block.type === 'tool_use') {
    const result = await callTool(block.name, block.input);
    // Send tool result back in a follow-up message
  }
}
```

**Why it works**: Tools use JSON Schema for input validation, and the multi-turn pattern lets Claude reason about results

---

## Streaming Responses

**Context**: Getting tokens as they're generated for real-time UX

**Example**:
```
const stream = client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Write a short poem.' }]
});

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}

const finalMessage = await stream.finalMessage();
```

**Why it works**: Streaming provides immediate feedback and the finalMessage() gives the complete response object for post-processing

---

## System Prompts

**Context**: Setting Claude's behavior and role

**Example**:
```
const message = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  system: 'You are a helpful code reviewer. Be concise and focus on bugs.',
  messages: [
    { role: 'user', content: 'Review this function: ...' }
  ]
});
```

**Why it works**: System prompts set consistent behavior without cluttering the conversation history

---
