# angular — Conventions

Naming and structural conventions for angular.

---

- Use standalone components (Angular 15+) over NgModules
- File naming: `feature-name.component.ts`, `feature-name.service.ts`
- Inject services via `inject()` function (Angular 14+) over constructor injection
- Use signals for local component state, RxJS for streams/async
- Prefer OnPush change detection strategy

---

_Customize these conventions based on your team's preferences._
