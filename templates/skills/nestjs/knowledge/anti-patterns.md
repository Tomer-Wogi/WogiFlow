# nestjs — Anti-Patterns

Common mistakes to avoid when working with nestjs.

---

## Business Logic in Controllers

**Problem**: Controllers handling data access and business rules

**Fix**: Move logic to services, controllers only handle HTTP concerns

**Example**:
```
// Bad: @Get() async find() { return this.repo.find({ where: { active: true } }); }
// Good: @Get() async find() { return this.userService.findActive(); }
```

---

## Circular Module Dependencies

**Problem**: Module A imports Module B which imports Module A

**Fix**: Use forwardRef() or extract shared logic to a common module

**Example**:
```
@Module({ imports: [forwardRef(() => UserModule)] })
```

---

