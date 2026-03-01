# svelte — Anti-Patterns

Common mistakes to avoid when working with svelte.

---

## Mutating $state Arrays Indirectly

**Problem**: Push/splice on $state arrays may not trigger updates

**Fix**: Reassign the array: `items = [...items, newItem]`

**Example**:
```
// Bad: items.push(newItem);
// Good: items = [...items, newItem];
```

---

