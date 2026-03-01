# playwright — Successful Patterns

Best practices for working with playwright.

---

## Locator-First Approach

**Context**: Finding elements reliably

**Example**:
```
const submitBtn = page.getByRole("button", { name: "Submit" });
await submitBtn.click();
await expect(page.getByText("Success")).toBeVisible();
```

**Why it works**: Role-based locators are resilient to DOM changes and match how users find elements

---

## Page Object Model

**Context**: Reusable page abstractions

**Example**:
```
class LoginPage {
  constructor(private page: Page) {}
  async login(email: string, password: string) {
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Log in" }).click();
  }
}
```

**Why it works**: Encapsulates page interactions, making tests maintainable when UI changes

---

