# vitest — Successful Patterns

Best practices for working with vitest.

---

## In-Source Testing

**Context**: Tests alongside implementation

**Example**:
```
// math.ts
export function add(a: number, b: number) { return a + b; }

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  it("adds numbers", () => expect(add(1, 2)).toBe(3));
}
```

**Why it works**: In-source tests are tree-shaken in production but run during testing

---

## vi.mock for Module Mocking

**Context**: Mocking modules (similar to jest.mock)

**Example**:
```
vi.mock("./database", () => ({
  getUser: vi.fn().mockResolvedValue({ id: 1 }),
}));
```

**Why it works**: vi.mock is hoisted to top of file like jest.mock, ensuring mocks are in place before imports

---

