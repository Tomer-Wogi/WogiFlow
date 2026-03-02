# openai — Successful Patterns

Best practices for working with the OpenAI SDK.

---

## Chat Completions Basic Usage

**Context**: Sending a chat message and getting a response

**Example**:
```
const OpenAI = require('openai');

const client = new OpenAI(); // Uses OPENAI_API_KEY env var

const completion = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain recursion in one sentence.' }
  ]
});

console.log(completion.choices[0].message.content);
```

**Why it works**: The SDK auto-reads the API key from the environment, and the chat completions API uses a familiar role/content structure

---

## Function Calling (Tool Use)

**Context**: Letting GPT call your functions

**Example**:
```
const completion = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is the weather in London?' }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' }
        },
        required: ['location']
      }
    }
  }]
});

const toolCall = completion.choices[0].message.tool_calls?.[0];
if (toolCall) {
  const args = JSON.parse(toolCall.function.arguments);
  const result = await getWeather(args.location);
  // Send tool result back in follow-up message
}
```

**Why it works**: Functions use JSON Schema for parameter validation, and the multi-turn pattern lets GPT reason about results

---

## Streaming Responses

**Context**: Getting tokens as they're generated for real-time UX

**Example**:
```
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Write a short poem.' }],
  stream: true
});

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) process.stdout.write(delta);
}
```

**Why it works**: Streaming provides immediate feedback and reduces perceived latency for users

---

## Structured Outputs

**Context**: Getting JSON responses that conform to a schema

**Example**:
```
const completion = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Extract the name and age.' }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'person',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        },
        required: ['name', 'age']
      }
    }
  }
});

const person = JSON.parse(completion.choices[0].message.content);
```

**Why it works**: Structured outputs guarantee the response matches your schema, eliminating parsing failures

---
