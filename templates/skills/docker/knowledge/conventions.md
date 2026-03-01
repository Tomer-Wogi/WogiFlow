# docker — Conventions

Naming and structural conventions for docker.

---

- Use multi-stage builds to minimize image size
- Pin base image versions (not :latest)
- Copy package files before source for layer caching
- Use .dockerignore to exclude node_modules, .git, etc.
- Run as non-root user in production
- Use HEALTHCHECK for container health monitoring

---

_Customize these conventions based on your team's preferences._
