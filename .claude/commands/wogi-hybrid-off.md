---
description: "Disable hybrid mode and return to direct Opus execution"
---

# Disable Hybrid Mode

Turning off multi-model hybrid execution. All tasks will be executed directly by Opus.

```bash
# Update config
cd "$(pwd)" && jq '.hybrid.enabled = false' .workflow/config.json > /tmp/wogi-config-tmp.json && mv /tmp/wogi-config-tmp.json .workflow/config.json

# Clean up session state
if [ -f ".workflow/state/current-plan.json" ]; then
    rm .workflow/state/current-plan.json
    echo "Removed active execution plan"
fi

echo "Hybrid mode disabled"
```

## What Changes

- All tasks are executed directly by Opus (no delegation to cheaper models)
- No execution plans are created — code is written directly
- No token savings from multi-model routing
- Simpler workflow, but higher token usage

## Your Configuration Is Preserved

- Cloud provider API keys remain configured
- Local LLM connections remain saved
- Smart routing rules remain in config
- Project templates remain generated

## Re-enabling

Run `/wogi-hybrid` to re-enable with your previous settings.
Run `/wogi-hybrid-setup` to reconfigure from scratch.
