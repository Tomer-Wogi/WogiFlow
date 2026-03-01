# vue — Successful Patterns

Best practices for working with vue.

---

## Composables for Shared Logic

**Context**: Reusable stateful logic across components

**Example**:
```
export function useCounter(initial = 0) {
  const count = ref(initial);
  const increment = () => count.value++;
  return { count, increment };
}
```

**Why it works**: Composables are Vue's equivalent of React hooks — testable, composable units of logic

---

## Script Setup for Cleaner Components

**Context**: Single File Components

**Example**:
```
<script setup lang="ts">
import { ref, computed } from 'vue';
const count = ref(0);
const doubled = computed(() => count.value * 2);
</script>
```

**Why it works**: Less boilerplate than Options API, better TypeScript inference, auto-exposed to template

---

