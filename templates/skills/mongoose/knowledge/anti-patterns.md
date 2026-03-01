# mongoose — Anti-Patterns

Common mistakes to avoid when working with mongoose.

---

## Deep Population Chains

**Problem**: populate("author").populate("author.posts").populate("author.posts.comments")

**Fix**: Denormalize frequently-accessed data or use aggregation pipeline

**Example**:
```
// Bad: 3+ levels of populate
// Good: Embed frequently-read data, or use $lookup aggregation
```

---

