# Testing Strategy

<!-- PINS: test-commands, verification-gates, windows-testing -->

## Current State
<!-- PIN: test-commands -->

- No formal test framework configured
- Manual testing via CLI commands

## Test Commands
```bash
# Health check
./scripts/flow health

# Verify workflow files
./scripts/flow verify

# Check knowledge sync
./scripts/flow knowledge-sync status
```

## Verification Gates
<!-- PIN: verification-gates -->

Configured in `config.json → qualityGates`:
- Lint check
- TypeScript type check
- Test execution (when configured)

## Future Considerations
- Add Jest or Vitest for unit tests
- Add integration tests for CLI commands
- Add E2E tests for full workflow scenarios

## Windows Testing Checklist
<!-- PIN: windows-testing -->

When testing WogiFlow on Windows with Claude Code 2.1.7+:

### Path Handling
- [ ] Verify temp directory paths work correctly
  - Windows paths may contain backslash sequences like `C:\temp` or `C:\new` where `\t` and `\n` could be misinterpreted as tab and newline escape sequences if not handled properly
- [ ] Confirm `path.join()` creates valid Windows paths
- [ ] Test file operations in OneDrive/Dropbox-synced directories

### File System
- [ ] Check no false "file modified" errors with cloud sync tools
- [ ] Verify antivirus scanner compatibility (Windows Defender)
- [ ] Test file watching doesn't trigger spurious updates

### Bash Commands
- [ ] Confirm bash commands execute correctly via Claude Code
- [ ] Verify escape sequences in paths are handled properly
- [ ] Test commands with spaces in directory names

### Quick Smoke Test
```powershell
# In PowerShell
npm install wogiflow
npx flow health
npx flow status
npx flow ready
```

**Note**: Claude Code 2.1.7 fixed several Windows-specific issues including path escape sequence handling and false "file modified" errors with cloud sync tools. If you encounter problems, ensure Claude Code is updated.

---

Generated: 2026-01-11
Last synced: 2026-01-14
