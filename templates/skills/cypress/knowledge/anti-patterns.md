# cypress — Anti-Patterns

Common mistakes to avoid when working with cypress.

---

## Using cy.wait(ms)

**Problem**: Arbitrary timeouts make tests slow and flaky

**Fix**: Wait for specific events: cy.wait("@alias") or assertion retries

**Example**:
```
// Bad: cy.wait(5000);
// Good: cy.wait("@apiCall"); or cy.get("...").should("be.visible");
```

---

