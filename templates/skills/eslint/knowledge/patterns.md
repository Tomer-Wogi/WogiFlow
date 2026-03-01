# eslint — Successful Patterns

Best practices for working with eslint.

---

## Flat Config (ESLint 9+)

**Context**: Modern ESLint configuration

**Example**:
```
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "no-console": "warn" } },
];
```

**Why it works**: Flat config is simpler, more composable, and the future of ESLint

---

