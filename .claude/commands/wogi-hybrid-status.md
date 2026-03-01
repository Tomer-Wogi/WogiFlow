---
description: "Show current hybrid mode configuration and routing table"
---

# Hybrid Mode Status

Let me check the current multi-model execution configuration:

```bash
echo "═══════════════════════════════════════════════════════════"
echo "              HYBRID MODE STATUS"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if enabled
ENABLED=$(jq -r '.hybrid.enabled // false' .workflow/config.json)
echo "Status: $ENABLED"

if [ "$ENABLED" = "true" ]; then
    echo ""
    echo "── Executor Configuration ──"
    EXEC_TYPE=$(jq -r '.hybrid.executor.type // "not set"' .workflow/config.json)
    EXEC_MODEL=$(jq -r '.hybrid.executor.model // "not set"' .workflow/config.json)
    echo "  Type: $EXEC_TYPE"
    echo "  Model: $EXEC_MODEL"

    echo ""
    echo "── Smart Routing ──"
    ROUTING_ENABLED=$(jq -r '.hybrid.routing.enabled // false' .workflow/config.json)
    echo "  Routing enabled: $ROUTING_ENABLED"
    if [ "$ROUTING_ENABLED" = "true" ]; then
        echo ""
        echo "  Task Type Routing:"
        jq -r '.hybrid.routing.rules[]? | "    \(.taskType) → \(.model) (\(.description // ""))"' .workflow/config.json
        echo ""
        echo "  Model Tiers:"
        echo "    Cheapest: $(jq -r '.hybrid.routing.tiers.cheapest // [] | join(", ")' .workflow/config.json)"
        echo "    Mid-tier: $(jq -r '.hybrid.routing.tiers["mid-tier"] // [] | join(", ")' .workflow/config.json)"
        echo "    Planner:  $(jq -r '.hybrid.routing.tiers.planner // "current"' .workflow/config.json)"
    fi

    echo ""
    echo "── Cloud Providers ──"
    jq -r '.hybrid.cloudProviders | to_entries[] | "  \(.key): \(.value.models | join(", ")) [env: \(.value.envKey)]"' .workflow/config.json

    echo ""
    echo "── Local Providers ──"
    echo "  Checking..."
    node scripts/flow-hybrid-detect.js providers 2>/dev/null | jq -r '.[] | "  \(.name): \(if .available then "✓ available (\(.models | length) models)" else "✗ not running" end)"' 2>/dev/null || echo "  Detection unavailable"

    echo ""
    echo "── Session State ──"
    if [ -f ".workflow/state/durable-history.json" ]; then
        ACTIVE=$(jq -r '.activeSession // empty' .workflow/state/durable-history.json 2>/dev/null)
        if [ -n "$ACTIVE" ] && [ "$ACTIVE" != "null" ]; then
            jq '.activeSession' .workflow/state/durable-history.json
        else
            echo "  No active session"
        fi
    else
        echo "  No durable session history"
    fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
```

## Quick Actions

- `/wogi-hybrid` — Enable hybrid mode
- `/wogi-hybrid-setup` — Run setup wizard
- `/wogi-hybrid-edit` — Edit current execution plan
- `/wogi-hybrid-off` — Disable hybrid mode
- `/wogi-hybrid --select-model` — Change executor model
