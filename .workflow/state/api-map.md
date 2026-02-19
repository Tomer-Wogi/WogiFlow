# API Map

API endpoints registry for preventing duplication.

---

## How to Use

Before creating any new API endpoint, check this file first.

### Scan & Generate
```bash
flow api-index scan    # Scan codebase for API endpoints
flow api-index map     # Generate this file from scan results
```

### Manual Entry Format
```markdown
### METHOD /path/to/endpoint
**File**: path/to/file.js
**Purpose**: Brief description
**Auth**: Required / Public
**Params**: { key: Type }
**Response**: { key: Type }
```

---

## Registered Endpoints

<!-- Endpoints will be populated by `flow api-index scan` or manually -->
<!-- WogiFlow project: This is a CLI tool, not an API server. -->
<!-- Target projects using WogiFlow should populate this with their API endpoints. -->

---
