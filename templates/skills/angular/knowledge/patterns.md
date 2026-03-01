# angular — Successful Patterns

Best practices for working with angular.

---

## Signals for Reactive State

**Context**: Angular 16+ reactive primitives

**Example**:
```
count = signal(0);
doubled = computed(() => this.count() * 2);
increment() { this.count.update(v => v + 1); }
```

**Why it works**: Signals provide fine-grained reactivity without RxJS complexity for simple state

---

## Smart/Dumb Component Pattern

**Context**: Separating data logic from presentation

**Example**:
```
// Smart: fetches data, handles events
// Dumb: receives @Input(), emits @Output(), pure rendering
```

**Why it works**: Improves testability and reusability of presentation components

---

