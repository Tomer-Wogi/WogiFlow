# mocha — Successful Patterns

Best practices for working with mocha.

---

## Nested Describe for Context

**Context**: Organizing tests by scenario

**Example**:
```
describe("UserService", () => {
  describe("when user exists", () => {
    it("should return the user", async () => { ... });
  });
  describe("when user not found", () => {
    it("should throw NotFoundError", async () => { ... });
  });
});
```

**Why it works**: Nested describes create readable test output grouped by context

---

