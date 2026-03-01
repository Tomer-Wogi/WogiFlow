# jest — Conventions

Naming and structural conventions for jest.

---

- Test files colocated with source: `user.service.test.ts`
- Use describe blocks to group related tests
- One assertion concern per test (may have multiple expect calls)
- Mock at the boundary (database, HTTP, file system), not internal functions
- Use jest.clearAllMocks() in beforeEach

---

_Customize these conventions based on your team's preferences._
