# External Integrations

> **Note**: External integrations (Jira, Linear) are not currently available.
> The implementations are archived in `.workflow/archive/paid-features/` and may be re-introduced in a future release via the WogiFlow Teams add-on.

Import and sync tasks from external project management tools.

---

## Supported Integrations (Archived)

| Platform | Status | Commands |
|----------|--------|----------|
| Jira | Archived | `flow jira list/sync/push/config` |
| Linear | Archived | `flow linear list/sync/push/config` |

---

## Jira Integration

### Configuration

Add to `.workflow/config.json`:

```json
{
  "integrations": {
    "jira": {
      "enabled": true,
      "baseUrl": "https://yourcompany.atlassian.net",
      "projectKey": "PROJ",
      "apiToken": "$JIRA_API_TOKEN",
      "email": "your@email.com"
    }
  }
}
```

### Commands

```bash
# List assigned issues
flow jira list

# Import issues to ready.json
flow jira sync

# Push completed tasks back to Jira
flow jira push

# Show configuration
flow jira config
```

### Environment Variables

- `JIRA_API_TOKEN` - Your Jira API token
- `JIRA_EMAIL` - Your Jira email (optional, can be in config)

---

## Linear Integration

### Configuration

Add to `.workflow/config.json`:

```json
{
  "integrations": {
    "linear": {
      "enabled": true,
      "apiKey": "$LINEAR_API_KEY",
      "teamId": "TEAM-123"
    }
  }
}
```

### Commands

```bash
# List assigned issues
flow linear list

# Import issues to ready.json
flow linear sync

# Push completed tasks back to Linear
flow linear push

# Show configuration
flow linear config
```

### Environment Variables

- `LINEAR_API_KEY` - Your Linear API key

---

## Combined View

```bash
# List tasks from all integrations
flow external-tasks
```

---

## Task Mapping

When importing, external tasks are mapped to WogiFlow tasks:

| External Field | WogiFlow Field |
|----------------|----------------|
| Title/Summary | `title` |
| Description | `description` |
| Priority | `priority` |
| Labels/Tags | `tags` |
| Issue Key | `externalId` |

---

## Sync Behavior

- **Import**: Creates new tasks in `ready.json` with `source: "jira"` or `source: "linear"`
- **Push**: Updates external issue status when task is completed via `/wogi-done`
- **Duplicates**: Checks `externalId` to avoid re-importing same issue

---

## Related

- [Task Planning](./01-task-planning.md) - How tasks are structured
- [Future Features](../future-features.md) - Background sync (planned)
