# mocha — Anti-Patterns

Common mistakes to avoid when working with mocha.

---

## Arrow Functions with this Context

**Problem**: Arrow functions don't bind `this`, breaking Mocha's context

**Fix**: Use regular functions when accessing this.timeout() or this.retries()

**Example**:
```
// Bad: it("test", () => { this.timeout(5000); });
// Good: it("test", function() { this.timeout(5000); });
```

---

