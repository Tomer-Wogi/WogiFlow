# next — Successful Patterns

Best practices for working with next.

---

## Server Components by Default

**Context**: Building pages with minimal client JS

**Example**:
```
// app/users/page.tsx (Server Component — no "use client")
export default async function UsersPage() {
  const users = await db.user.findMany();
  return <UserList users={users} />;
}
```

**Why it works**: Server Components send zero JS to the client, reducing bundle size and improving performance

---

## Server Actions for Mutations

**Context**: Form submissions and data mutations

**Example**:
```
'use server';
export async function createUser(formData: FormData) {
  const name = formData.get('name') as string;
  await db.user.create({ data: { name } });
  revalidatePath('/users');
}
```

**Why it works**: Server Actions eliminate API route boilerplate for mutations and integrate with form elements

---

## Layout Composition for Shared UI

**Context**: Persistent navigation, sidebars, providers

**Example**:
```
// app/dashboard/layout.tsx
export default function DashboardLayout({ children }) {
  return (
    <div className="flex">
      <Sidebar />
      <main>{children}</main>
    </div>
  );
}
```

**Why it works**: Layouts persist across navigations, avoiding re-renders and maintaining scroll position

---

