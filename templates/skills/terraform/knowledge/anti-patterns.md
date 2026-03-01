# terraform — Anti-Patterns

Common mistakes to avoid when working with terraform.

---

## Hardcoding Values

**Problem**: Environment-specific values baked into .tf files

**Fix**: Use variables with .tfvars files per environment

**Example**:
```
# Bad: cidr_block = "10.0.0.0/16"
# Good: cidr_block = var.vpc_cidr
```

---

## Monolithic Root Module

**Problem**: Everything in a single directory with hundreds of resources

**Fix**: Split into modules by component: networking, compute, database

**Example**:
```
modules/
  vpc/
  ecs/
  rds/
```

---

