# tailwindcss — Anti-Patterns

Common mistakes to avoid when working with tailwindcss.

---

## Overusing @apply

**Problem**: Moving all utilities into CSS files defeats the purpose of Tailwind

**Fix**: Extract components instead of CSS classes. Only use @apply for truly global base styles

**Example**:
```
// Bad: @apply flex items-center gap-2 px-4 py-2 rounded;
// Good: Extract a Button component
```

---

## Arbitrary Values Everywhere

**Problem**: Using arbitrary values like `w-[347px]` instead of design tokens

**Fix**: Extend the theme in tailwind.config.js for repeated custom values

**Example**:
```
// Bad: className="mt-[13px] w-[347px]"
// Good: Extend theme: spacing: { 'card': '347px' }
```

---

