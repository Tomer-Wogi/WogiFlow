# terraform — Conventions

Naming and structural conventions for terraform.

---

- Use modules for reusable components
- Remote state with locking (S3 + DynamoDB or equivalent)
- Variables in variables.tf, outputs in outputs.tf
- Environment separation via workspaces or directory structure
- Always run `terraform plan` before `apply`
- Pin provider versions in required_providers block

---

_Customize these conventions based on your team's preferences._
