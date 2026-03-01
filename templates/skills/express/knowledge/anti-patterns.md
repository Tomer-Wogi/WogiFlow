# express — Anti-Patterns

Common mistakes to avoid when working with express.

---

## Not Calling next() in Middleware

**Problem**: Request hangs because middleware doesn't call next()

**Fix**: Always call next() unless you're sending a response

**Example**:
```
// Bad: app.use((req, res, next) => { req.user = getUser(req); });
// Good: app.use((req, res, next) => { req.user = getUser(req); next(); });
```

---

## Swallowing Errors in Async Routes

**Problem**: Unhandled promise rejections crash the server

**Fix**: Use asyncHandler wrapper or express-async-errors package

**Example**:
```
// Bad: router.get("/", async (req, res) => { ... });
// Good: router.get("/", asyncHandler(async (req, res) => { ... }));
```

---

