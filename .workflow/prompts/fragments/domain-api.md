---
id: domain-api
purpose: domain
order: 30
models: all
cli: all
domain: api
description: API development guidelines
---

# API Development

## Endpoint Design
- Use RESTful conventions (GET, POST, PUT, DELETE)
- Version APIs when breaking changes are needed
- Return consistent response structures

## Request Handling
- Validate all inputs
- Use appropriate HTTP status codes
- Include error details in response body

## Security
- Authenticate requests appropriately
- Validate authorization for each action
- Sanitize inputs to prevent injection
