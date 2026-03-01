# playwright — Anti-Patterns

Common mistakes to avoid when working with playwright.

---

## Hard-Coded Waits

**Problem**: Using page.waitForTimeout(5000) instead of proper assertions

**Fix**: Use auto-waiting locators and web-first assertions

**Example**:
```
// Bad: await page.waitForTimeout(3000);
// Good: await expect(page.getByText("Loaded")).toBeVisible();
```

---

## CSS/XPath Selectors

**Problem**: Fragile selectors tied to DOM structure

**Fix**: Use role, label, and text locators

**Example**:
```
// Bad: page.locator(".btn-primary.submit-form")
// Good: page.getByRole("button", { name: "Submit" })
```

---

