# [wf-bcb6ce5e] Add Phase 0 External Research for comparison questions

## User Story
**As a** WogiFlow user doing external comparison research
**I want** the protocol to do external research FIRST before local scope mapping
**So that** I know what to search for locally based on what the external tool/project has

## Description
The current research protocol assumes local-first: scope map local files, gather local evidence, then verify externally. But for external comparison questions ("What can we learn from X?"), this is backwards. You need to understand what X has FIRST, then you know what to search for locally. This adds an optional Phase 0 that runs BEFORE Phase 1 when the question is about external comparison.

## The Problem (Actual Example)

**Question**: "What can we learn from Crush for hybrid mode?"

**Wrong flow (current)**:
1. Scope map WogiFlow files
2. Gather local evidence
3. External verification (search Crush)
4. → But you don't know what Crush has until step 3, so steps 1-2 are blind

**Correct flow (needed)**:
1. **Phase 0**: External research - understand what Crush has
2. Phase 1: Scope map - NOW search WogiFlow for equivalent features
3. Phase 2: Local evidence - read files for each Crush feature
4. → Now you can compare properly

## Acceptance Criteria

### Scenario 1: External comparison triggers Phase 0
**Given** a comparison question about an external tool/project
**When** the research protocol initializes
**Then** Phase 0 (External Research) is added to the phases
**And** it runs BEFORE Phase 1 (Scope Mapping)

### Scenario 2: Phase 0 informs Phase 1
**Given** Phase 0 has completed with findings about external tool
**When** Phase 1 (Scope Mapping) runs
**Then** it uses the external findings to determine what local files to search
**And** the scope is targeted based on what was found externally

### Scenario 3: Non-external questions skip Phase 0
**Given** a question that is NOT about external comparison (e.g., "Does this support X?")
**When** the research protocol initializes
**Then** Phase 0 is NOT included
**And** the protocol starts at Phase 1 as before

### Scenario 4: Documentation reflects correct flow
**Given** the `/wogi-research` documentation
**When** a user reads about comparison questions
**Then** it clearly shows Phase 0 runs first for external comparison

## Technical Notes
- **Components**:
  - Modify: `scripts/flow-research-protocol.js` - Add Phase 0 to session for comparison questions
  - Modify: `scripts/hooks/core/research-gate.js` - Update protocol steps to show Phase 0 first
  - Modify: `.claude/commands/wogi-research.md` - Document the correct flow
- **Phase 0 structure**:
  ```javascript
  externalResearch: {
    status: 'pending',
    completedAt: null,
    findings: [],
    externalSources: []
  }
  ```
- **Flow detection**: If question matches `comparison` patterns AND mentions external entity

## Test Strategy
- [ ] Unit: Test comparison questions include Phase 0
- [ ] Unit: Test non-comparison questions exclude Phase 0
- [ ] Integration: Test full flow with external comparison

## Dependencies
- wf-87903e05 (completed) - Added comparison question type

## Complexity
Low - Adding conditional phase to existing infrastructure

## Out of Scope
- Automatic external research execution (AI must manually research)
