# cypress — Successful Patterns

Best practices for working with cypress.

---

## Custom Commands for Reuse

**Context**: Abstracting common test flows

**Example**:
```
Cypress.Commands.add("login", (email, password) => {
  cy.visit("/login");
  cy.get("[data-testid=email]").type(email);
  cy.get("[data-testid=password]").type(password);
  cy.get("button[type=submit]").click();
});
```

**Why it works**: Custom commands reduce duplication and create a readable test DSL

---

## Network Stubbing with Intercept

**Context**: Controlling API responses

**Example**:
```
cy.intercept("GET", "/api/users", { fixture: "users.json" }).as("getUsers");
cy.visit("/users");
cy.wait("@getUsers");
```

**Why it works**: Intercept isolates tests from backend, making them fast and deterministic

---

