# [wf-0bff91f3] Implement permission persistence with session vs permanent choice

## User Story
**As a** WogiFlow user
**I want** to grant permissions for workflow operations with a choice of "this session only" or "always"
**So that** I don't have to re-approve the same operations repeatedly while maintaining control over permanent permissions

## Description
Currently WogiFlow doesn't track user permission grants. When the AI asks "Can I run tests?" or "Can I create this file?", there's no persistence. Inspired by Crush's permission system, this feature adds permission persistence where the user explicitly chooses: grant for this session (clears when session ends) or grant permanently (persists in `.workflow/state/permissions.json`). This reduces friction while keeping the user in control.

## Acceptance Criteria

### Scenario 1: Grant permission for session only (default)
**Given** the AI requests permission to perform an operation
**When** the user grants permission and selects "This session" (default)
**Then** the permission is stored in memory
**And** future identical requests in this session auto-approve
**And** the permission is NOT written to permissions.json

### Scenario 2: Grant permission permanently
**Given** the AI requests permission to perform an operation
**When** the user grants permission and selects "Always"
**Then** the permission is stored in `.workflow/state/permissions.json`
**And** future sessions auto-approve the same operation

### Scenario 3: View granted permissions
**Given** permissions have been granted (session and/or permanent)
**When** the user runs `flow permissions list`
**Then** they see all session permissions (marked as temporary)
**And** they see all permanent permissions (marked as persistent)

### Scenario 4: Revoke permanent permission
**Given** a permanent permission exists
**When** the user runs `flow permissions revoke <operation>`
**Then** the permission is removed from permissions.json
**And** future requests require explicit approval again

### Scenario 5: Session end clears session permissions
**Given** session-only permissions were granted
**When** the session ends (via `/wogi-session-end` or new session starts)
**Then** all session-only permissions are cleared
**And** permanent permissions remain

## Technical Notes
- **Components**:
  - Create: `scripts/flow-permissions.js` - Core permission management
  - Modify: `scripts/flow-session-end.js` - Clear session permissions
  - Modify: `scripts/flow-start.js` - Load permanent permissions
  - Create: `.workflow/state/permissions.json` - Persistent storage
- **State**:
  - Runtime: `sessionPermissions` map in memory
  - Persistent: `.workflow/state/permissions.json`
- **Format**:
  ```json
  {
    "permissions": {
      "run-tests": { "grantedAt": "...", "scope": "always" },
      "create-file:src/**": { "grantedAt": "...", "scope": "always" }
    }
  }
  ```
- **Constraints**:
  - Permission keys should be specific enough to be meaningful
  - Must not auto-grant permissions the user never explicitly approved

## Test Strategy
- [ ] Unit: Test permission grant/check/revoke logic
- [ ] Unit: Test session vs permanent storage
- [ ] Integration: Test session end clears session permissions
- [ ] Integration: Test permanent permissions survive restart

## Dependencies
- None

## Complexity
Medium - New subsystem but straightforward logic

## Out of Scope
- UI for permission management (CLI only)
- Permission categories/groups
- Time-based permission expiry
