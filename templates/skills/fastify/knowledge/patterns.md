# fastify — Successful Patterns

Best practices for working with fastify.

---

## Plugin Encapsulation

**Context**: Organizing routes and shared logic

**Example**:
```
async function userRoutes(fastify, opts) {
  fastify.get("/", async (req) => {
    return fastify.db.user.findMany();
  });
}
module.exports = userRoutes;
```

**Why it works**: Fastify plugins get their own encapsulated context, preventing cross-contamination

---

## JSON Schema Validation

**Context**: Request/response validation

**Example**:
```
fastify.post("/users", {
  schema: {
    body: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    response: { 200: { type: "object", properties: { id: { type: "number" } } } }
  }
}, handler);
```

**Why it works**: Built-in schema validation is faster than middleware-based validation and auto-generates docs

---

