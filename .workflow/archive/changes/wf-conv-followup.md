# [wf-conv-followup] Add conversational follow-up handling to /wogi-start

## User Story
**As a** WogiFlow user
**I want** /wogi-start to handle short conversational responses like "yes", "no", "go ahead", "approved"
**So that** the routing doesn't break when I'm responding to a question the AI asked me in the conversation

## Description
When /wogi-start receives a short conversational follow-up (e.g., "yes", "approved", "go ahead", "no thanks") without an active task, it currently has no category for these messages. The AI asked a question, the user answered, and that answer gets routed through /wogi-start which doesn't know what to do with it. The fix is to add a "Conversational Follow-ups" category that instructs /wogi-start to look back at the conversation context to determine what the user is responding to, then act accordingly.

## Acceptance Criteria

### Scenario 1: User responds "yes" to AI question
**Given** the AI asked a clarifying question (e.g., "Should I create this story?")
**When** the user responds with "yes" or "go ahead" or "approved"
**Then** /wogi-start looks back at conversation context, identifies the pending question, and executes the implied action

### Scenario 2: User responds "no" to AI question
**Given** the AI asked a clarifying question
**When** the user responds with "no" or "not now" or "skip that"
**Then** /wogi-start identifies what was being asked and acknowledges the rejection, asking what to do instead

### Scenario 3: User provides short directive follow-up
**Given** there was a prior discussion about an approach
**When** the user says "do it", "sounds good", "let's go with option 2"
**Then** /wogi-start identifies the referenced approach from conversation history and proceeds

## Technical Notes
- **Files to change**: `.claude/commands/wogi-start.md`
- Add new section in "Request Categories (Decision Guide)" for conversational follow-ups
- Add examples in the Examples section
- No code changes — this is prompt/instruction modification only

## Test Strategy
- [ ] Manual: Verify wogi-start.md contains new section
- [ ] Manual: Verify examples cover yes/no/go ahead patterns

## Dependencies
- wf-dbccc898 (completed) — bypass loophole removal
- wf-16d64c68 (completed) — NLD routing amendment

## Complexity
Low - Adding a new category section to an existing command file
