# angular — Anti-Patterns

Common mistakes to avoid when working with angular.

---

## Subscribing Without Unsubscribing

**Problem**: Memory leaks from uncleaned RxJS subscriptions

**Fix**: Use async pipe in templates, takeUntilDestroyed(), or DestroyRef

**Example**:
```
// Good: this.data$ = this.service.getData();
// Template: {{ data$ | async }}
```

---

## God Services

**Problem**: Services with too many responsibilities

**Fix**: Split into focused services: AuthService, UserService, NotificationService

**Example**:
```
// Bad: AppService with 50 methods
// Good: Focused single-responsibility services
```

---

