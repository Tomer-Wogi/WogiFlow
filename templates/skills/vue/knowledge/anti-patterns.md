# vue — Anti-Patterns

Common mistakes to avoid when working with vue.

---

## Mutating Props Directly

**Problem**: Changing prop values inside child components

**Fix**: Emit events to parent, use v-model for two-way binding

**Example**:
```
// Bad: props.value = newVal;
// Good: emit('update:modelValue', newVal);
```

---

## Reactive Destructuring Without toRefs

**Problem**: Destructuring reactive objects loses reactivity

**Fix**: Use toRefs() when destructuring reactive objects

**Example**:
```
// Bad: const { name } = reactive({ name: "Vue" });
// Good: const { name } = toRefs(reactive({ name: "Vue" }));
```

---

