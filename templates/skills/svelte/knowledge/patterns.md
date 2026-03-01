# svelte — Successful Patterns

Best practices for working with svelte.

---

## Runes for Reactive State (Svelte 5)

**Context**: Declaring reactive variables

**Example**:
```
let count = $state(0);
let doubled = $derived(count * 2);
$effect(() => console.log(count));
```

**Why it works**: Runes make reactivity explicit and work anywhere (not just .svelte files)

---

## SvelteKit Load Functions

**Context**: Server-side data loading

**Example**:
```
// +page.server.ts
export async function load({ params }) {
  const user = await db.user.findUnique({ where: { id: params.id } });
  return { user };
}
```

**Why it works**: Load functions run on the server, keeping secrets safe and enabling SSR

---

