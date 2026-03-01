# django — Successful Patterns

Best practices for working with django.

---

## Fat Models, Thin Views

**Context**: Business logic placement

**Example**:
```
class Order(models.Model):
    def calculate_total(self):
        return sum(item.subtotal for item in self.items.all())
    
    def can_cancel(self):
        return self.status in ["pending", "confirmed"]
```

**Why it works**: Models are easier to test than views, and logic stays close to the data

---

## select_related / prefetch_related

**Context**: Query optimization

**Example**:
```
# One query with JOIN
Order.objects.select_related("customer").all()
# Two queries, batched
Author.objects.prefetch_related("books").all()
```

**Why it works**: Prevents N+1 queries when accessing related objects

---

