# PRD Management

Load and query Product Requirement Documents for task context.

---

## Overview

PRD Management allows you to load large specification documents and query relevant sections for specific tasks. PRDs are chunked and stored in the memory database for semantic retrieval.

**Script**: `flow-prd-manager.js`

---

## Commands

```bash
# Load a PRD into memory
flow prd load <file>

# Get relevant PRD context for a task
flow prd context "<task description>"

# List all loaded PRDs
flow prd list

# Clear all PRD data
flow prd clear
```

---

## How It Works

### 1. Loading

When you load a PRD:
1. Document is parsed (Markdown, text, or JSON)
2. Split into semantic chunks (~500-1000 tokens each)
3. Embeddings generated for each chunk
4. Stored in `.workflow/memory/local.db`

### 2. Querying

When you request context:
1. Task description is embedded
2. Semantic search finds relevant chunks
3. Top chunks returned with relevance scores

---

## Example Workflow

```bash
# Load the product spec
flow prd load docs/product-spec.md

# Starting a task - get relevant requirements
flow prd context "implement user authentication"

# Output shows relevant PRD sections:
# - Section 3.2: Authentication Requirements
# - Section 5.1: Security Considerations
# - Section 2.4: User Stories - Login
```

---

## Supported Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Markdown | `.md` | Headers become section boundaries |
| Plain Text | `.txt` | Paragraph-based chunking |
| JSON | `.json` | Object-based chunking |

---

## Storage

PRD chunks are stored in SQLite:

```sql
-- View loaded PRDs
SELECT DISTINCT source_file FROM prd_chunks;

-- Count chunks per PRD
SELECT source_file, COUNT(*) FROM prd_chunks GROUP BY source_file;
```

---

## Integration with Tasks

When starting a task with `/wogi-start`:
1. System can auto-query PRD for task context
2. Relevant requirements injected into prompt
3. Helps maintain spec compliance

Enable in config:
```json
{
  "prd": {
    "autoInject": true,
    "maxChunks": 3
  }
}
```

---

## Related

- [Memory Systems](./memory-systems.md) - How memory database works
- [Context Management](./context-management.md) - Token budget management
