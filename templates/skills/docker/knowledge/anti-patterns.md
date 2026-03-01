# docker — Anti-Patterns

Common mistakes to avoid when working with docker.

---

## Running as Root

**Problem**: Container processes run as root by default

**Fix**: Add USER directive after installing dependencies

**Example**:
```
RUN addgroup -S app && adduser -S app -G app
USER app
```

---

## Using :latest Tag

**Problem**: Builds are not reproducible

**Fix**: Pin specific versions: node:20.11-alpine

**Example**:
```
# Bad: FROM node:latest
# Good: FROM node:20.11-alpine
```

---

