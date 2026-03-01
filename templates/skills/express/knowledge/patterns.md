# express — Successful Patterns

Best practices for working with express.

---

## Centralized Error Handler

**Context**: Catching and formatting all errors consistently

**Example**:
```
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({
    error: { message: err.message, code: err.code }
  });
});
```

**Why it works**: Single error handler prevents duplicate error formatting across routes

---

## Async Handler Wrapper

**Context**: Catching async errors without try-catch in every route

**Example**:
```
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get("/users", asyncHandler(async (req, res) => {
  const users = await User.findAll();
  res.json(users);
}));
```

**Why it works**: Forwards unhandled promise rejections to the error handler middleware

---

## Router Modularization

**Context**: Organizing routes by resource

**Example**:
```
// routes/users.js
const router = express.Router();
router.get("/", listUsers);
router.post("/", createUser);
module.exports = router;

// app.js
app.use("/api/users", require("./routes/users"));
```

**Why it works**: Keeps route files focused and manageable as the API grows

---

