# playwright — Conventions

Naming and structural conventions for playwright.

---

- Use getByRole, getByText, getByLabel — not CSS selectors
- One assertion per test when possible
- Use test fixtures for shared setup
- Run tests in CI with `npx playwright test --reporter=html`

---

_Customize these conventions based on your team's preferences._
