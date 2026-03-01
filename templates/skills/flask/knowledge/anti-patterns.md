# flask — Anti-Patterns

Common mistakes to avoid when working with flask.

---

## Global App Object

**Problem**: Importing app directly causes circular imports

**Fix**: Use application factory + current_app proxy

**Example**:
```
# Bad: from app import app
# Good: from flask import current_app
```

---

