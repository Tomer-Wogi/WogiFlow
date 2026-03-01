# terraform — Successful Patterns

Best practices for working with terraform.

---

## Module Composition

**Context**: Reusable infrastructure components

**Example**:
```
module "vpc" {
  source = "./modules/vpc"
  cidr_block = var.vpc_cidr
  environment = var.environment
}

module "ecs" {
  source = "./modules/ecs"
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnet_ids
}
```

**Why it works**: Modules encapsulate infrastructure patterns, making them reusable and testable

---

## Remote State Backend

**Context**: Team collaboration

**Example**:
```
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "prod/terraform.tfstate"
    region = "us-east-1"
    encrypt = true
    dynamodb_table = "terraform-locks"
  }
}
```

**Why it works**: Remote state enables team collaboration and prevents concurrent modifications

---

