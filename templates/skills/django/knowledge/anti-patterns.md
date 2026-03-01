# django — Anti-Patterns

Common mistakes to avoid when working with django.

---

## Querying in Templates

**Problem**: Template tags triggering database queries

**Fix**: Prepare all data in the view, pass via context

**Example**:
```
# Bad: {% for post in user.posts.all %} in template
# Good: context["posts"] = user.posts.select_related("author")
```

---

