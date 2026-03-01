# jest — Successful Patterns

Best practices for working with jest.

---

## Arrange-Act-Assert

**Context**: Structuring test cases

**Example**:
```
it("should create a user", async () => {
  // Arrange
  const input = { name: "Alice", email: "alice@test.com" };
  // Act
  const user = await createUser(input);
  // Assert
  expect(user.name).toBe("Alice");
  expect(user.id).toBeDefined();
});
```

**Why it works**: Clear structure makes tests readable and maintainable

---

## Module Mocking

**Context**: Isolating units from dependencies

**Example**:
```
jest.mock("./database");
const { getUser } = require("./database");
getUser.mockResolvedValue({ id: 1, name: "Alice" });
```

**Why it works**: Module-level mocking replaces entire module implementations for isolation

---

