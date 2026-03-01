# next — Conventions

Naming and structural conventions for next.

---

- Use App Router (app/) for new projects, not Pages Router (pages/)
- File naming: page.tsx, layout.tsx, loading.tsx, error.tsx, not-found.tsx
- Colocate route-specific components in the route folder
- Use route groups (parentheses) for layout organization: `(auth)/login/page.tsx`
- Prefer Server Components — only add "use client" when necessary
- Use next/image for images, next/link for navigation

---

_Customize these conventions based on your team's preferences._
