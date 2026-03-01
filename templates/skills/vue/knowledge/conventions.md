# vue — Conventions

Naming and structural conventions for vue.

---

- Use Composition API with <script setup> for new components
- Name composables with `use` prefix: `useAuth`, `useFetch`
- Components PascalCase: `UserProfile.vue`
- Use Pinia for state management (not Vuex)
- Prefer `ref()` for primitives, `reactive()` for objects

---

_Customize these conventions based on your team's preferences._
