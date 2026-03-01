# django — Conventions

Naming and structural conventions for django.

---

- One app per feature: users/, orders/, products/
- Always use migrations (python manage.py makemigrations)
- Use class-based views for standard CRUD, function views for custom logic
- Use Django REST Framework for API endpoints
- Use select_related (FK) and prefetch_related (M2M) to prevent N+1

---

_Customize these conventions based on your team's preferences._
