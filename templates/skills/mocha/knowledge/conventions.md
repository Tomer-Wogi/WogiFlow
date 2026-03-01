# mocha — Conventions

Naming and structural conventions for mocha.

---

- Use regular functions (not arrows) when you need Mocha context (this)
- Use chai for assertions: expect(x).to.equal(y)
- Organize: describe per module, nested describe per scenario
- Clean up in afterEach, not in the test itself

---

_Customize these conventions based on your team's preferences._
