# Request Log Archive - 2026-01

Archived entries from request-log.md.

---

### R-001 | 2026-01-08 17:28
**Type**: fix
**Tags**: #test #bugfix #persistence
**Request**: "Test bug fix persistence verification"
**Result**: Verified that request log entries are saved correctly
**Files**: scripts/flow-utils.js

### R-002 | 2026-01-10 14:20
**Type**: new
**Tags**: #feature:transcript-digestion #skill #wf-4c237257-01
**Request**: "E1-S1: Skill Structure and State Management for Transcript Digestion"
**Result**: Created complete skill structure with:
- skill.md with metadata and documentation
- commands/digest.md - entry point command
- rules/extraction-rules.md - extraction guidelines
- knowledge/patterns.md - successful patterns
- knowledge/anti-patterns.md - common failures
- knowledge/learnings.md - auto-updated learnings
- templates/ - JSON schemas for state files
- Config section in config.json (transcriptDigestion)
- State directory .workflow/state/digests/
- Registered skill in skills.installed
**Files**:
- .claude/skills/transcript-digestion/skill.md
- .claude/skills/transcript-digestion/commands/digest.md
- .claude/skills/transcript-digestion/rules/extraction-rules.md
- .claude/skills/transcript-digestion/knowledge/patterns.md
- .claude/skills/transcript-digestion/knowledge/anti-patterns.md
- .claude/skills/transcript-digestion/knowledge/learnings.md
- .claude/skills/transcript-digestion/templates/*.json
- .workflow/config.json
- .workflow/state/digests/active-digest.json

### R-003 | 2026-01-10 14:35
**Type**: new
**Tags**: #feature:transcript-digestion #pass-1 #wf-4c237257-02
**Request**: "E1-S2: Pass 1 - Topic Extraction"
**Result**: Implemented topic extraction:
- Created pass-1-topic-extraction.md with extraction algorithm
- Created flow-transcript-digest.js CLI script
- Added session management (create, load, save)
- Added content classification (code, requirements, transcript)
- Added topic saving/loading functions
- Integrated with flow CLI (transcript-digest command)
**Files**:
- .claude/skills/transcript-digestion/rules/pass-1-topic-extraction.md
- scripts/flow-transcript-digest.js
- scripts/flow

### R-004 | 2026-01-10 15:10
**Type**: new
**Tags**: #feature:transcript-digestion #pass-2 #wf-4c237257-03
**Request**: "E1-S3: Pass 2 - Statement Association"
**Result**: Implemented statement association:
- Created pass-2-statement-association.md with association algorithm
- Added filler/greeting detection (FILLER_PATTERNS, isMeaningfulStatement)
- Added statement splitting (splitIntoStatements)
- Added topic association with confidence scoring (associateStatements)
- Added contradiction detection (detectContradictions)
- Added statement map save/load (saveStatementMap, loadStatementMap)
- Added runPass2 function for complete pass execution
- Added CLI commands: pass2, statement-map, orphans, contradictions
**Files**:
- .claude/skills/transcript-digestion/rules/pass-2-statement-association.md
- scripts/flow-transcript-digest.js

### R-005 | 2026-01-10 15:30
**Type**: new
**Tags**: #feature:transcript-digestion #pass-3 #wf-4c237257-04
**Request**: "E1-S4: Pass 3 - Orphan Check"
**Result**: Implemented orphan resolution:
- Created pass-3-orphan-check.md with resolution algorithm
- Added semantic expansion mappings (SEMANTIC_EXPANSIONS) for 15 term groups
- Added orphan resolution (resolveOrphan, calculateExpandedConfidence)
- Added new topic creation from orphan clusters (createTopicFromOrphans)
- Added General catch-all topic (ensureGeneralTopic)
- Added orphan data save/load (saveOrphans, loadOrphans)
- Added runPass3 function with 3-phase resolution:
  1. Semantic expansion matching
  2. Orphan clustering into new topics
  3. General assignment for unresolved
- Added CLI commands: pass3, coverage
**Files**:
- .claude/skills/transcript-digestion/rules/pass-3-orphan-check.md
- scripts/flow-transcript-digest.js

### R-006 | 2026-01-10 15:50
**Type**: new
**Tags**: #feature:transcript-digestion #pass-4 #wf-4c237257-05
**Request**: "E1-S5: Pass 4 - Contradiction Resolution"
**Result**: Implemented contradiction resolution:
- Created pass-4-contradiction-resolution.md with resolution algorithm
- Added correction phrase patterns (CORRECTION_PATTERNS) for 11 phrases
- Added additive pattern detection (ADDITIVE_PATTERNS) to identify non-contradictions
- Added correction phrase detection (detectCorrectionPhrase)
- Added resolution confidence calculation (calculateResolutionConfidence)
- Added clarification question generation (generateContradictionQuestion)
- Added clarifications save/load (saveClarifications, loadClarifications)
- Added runPass4 function with:
  - Auto-resolution when confidence >= 0.8
  - Additive pattern filtering
  - Clarification question generation for ambiguous cases
  - Superseded statement marking
- Added CLI commands: pass4, clarifications
**Files**:
- .claude/skills/transcript-digestion/rules/pass-4-contradiction-resolution.md
- scripts/flow-transcript-digest.js

### R-007 | 2026-01-10 16:15
**Type**: new
**Tags**: #feature:transcript-digestion #clarification #wf-4c237257-06
**Request**: "E2-S1: Question Generation Logic"
**Result**: Implemented question generation:
- Created question-generation.md with generation algorithm
- Added entity patterns (ENTITY_PATTERNS) for 8 UI component types
- Added vague patterns (VAGUE_PATTERNS) for 9 vague statement types
- Added question templates (QUESTION_TEMPLATES) with examples and priorities
- Added detail detection patterns (DETAIL_PATTERNS) to avoid duplicate questions
- Added analyzeCompleteness() for missing detail detection
- Added detectVagueness() for vague statement identification
- Added generateQuestionsForTopic() for per-topic question generation
- Added generateAllQuestions() for full question generation run
- Added CLI commands: questions, show-questions
**Files**:
- .claude/skills/transcript-digestion/rules/question-generation.md
- scripts/flow-transcript-digest.js

### R-008 | 2026-01-10 13:50
**Type**: new
**Tags**: #feature:transcript-digestion #conversation #wf-4c237257-07
**Request**: "E2-S2: Clarification Conversation Loop"
**Result**: Implemented conversational clarification flow:
- Created clarification-loop.md with conversation flow rules
- Added parseAnswers() for natural language answer parsing:
  - Numbered responses (1. answer, 2. answer)
  - Keyword matching (for X, the Y should be...)
  - Sequential matching (answer. answer. answer.)
  - Single question fallback
- Added captureAnswer() for answer storage
- Added createDerivedStatement() for converting answers to statements
- Added checkFollowups() with FOLLOWUP_TRIGGERS for follow-up generation
- Added addFollowupQuestions() for adding triggered follow-ups
- Added checkCompletion() for detecting all questions answered
- Added getQuestionsForPresentation() for prioritized question batching
- Added formatQuestionsForUser() for markdown output
- Added processConversationResponse() for full conversation processing
- Added resolveContradictionWithChoice() for user contradiction resolution
- Added CLI commands: answer, capture-answer, next-questions, completion-status, resolve-contradiction
**Files**:
- .claude/skills/transcript-digestion/rules/clarification-loop.md
- scripts/flow-transcript-digest.js

### R-009 | 2026-01-10 14:15
**Type**: new
**Tags**: #feature:transcript-digestion #voice #wf-4c237257-08
**Request**: "E2-S3: Voice Answer Integration"
**Result**: Implemented voice answer processing:
- Created voice-answer-integration.md with voice normalization rules
- Added isVoiceInput() for auto-detecting voice transcriptions
- Added VOICE_FILLERS patterns for filler removal (um, uh, like, you know)
- Added VOICE_CORRECTIONS patterns for self-correction detection
- Added removeFillers() for cleaning filler words
- Added applySelfCorrections() for handling "actually", "wait", "I mean"
- Added normalizeNumbers() for spoken number conversion (five → 5)
- Added detectUncertainty() for flagging uncertain answers
- Added detectYesNo() for yes/no pattern recognition
- Added addPunctuation() for run-on voice text
- Added normalizeVoiceInput() full pipeline
- Added processVoiceAnswer() main entry point
- Integrated voice processing into processConversationResponse()
- Added --voice flag to answer command
- Added voice-normalize CLI command for testing
**Files**:
- .claude/skills/transcript-digestion/rules/voice-answer-integration.md
- scripts/flow-transcript-digest.js

### R-010 | 2026-01-10 14:06
**Type**: new
**Tags**: #feature:transcript-digestion #persistence #wf-4c237257-09
**Request**: "E2-S4: Clarification State Persistence"
**Result**: Implemented session persistence and recovery:
- Created state-persistence.md with persistence architecture rules
- Added conversation.json initialization in createSession()
- Added loadConversation(), saveConversation(), initializeConversation()
- Added recordInteraction() for tracking all user interactions
- Added createCheckpoint() for recovery points
- Added detectInterruptedSession() for detecting abandoned sessions
- Added generateRecoverySummary() for context recovery
- Added resumeSession() for continuing interrupted sessions
- Added markQuestionsPresented() for tracking question display
- Added getSessionHistory() for session stats
- Added exportSession() with JSON and Markdown formats
- Added reviewAnswers() for reviewing all captured answers
- Integrated interaction recording into processConversationResponse()
- Fixed regex escaping bug in parseAnswers() keyword matching
- Added CLI commands: resume, review, history, export
**Files**:
- .claude/skills/transcript-digestion/rules/state-persistence.md
- scripts/flow-transcript-digest.js

### R-011 | 2026-01-10 16:45
**Type**: new
**Tags**: #feature:transcript-digestion #complexity #wf-4c237257-10
**Request**: "E3-S1: Adaptive Complexity Detection"
**Result**: Implemented complexity detection and output structure recommendation:
- Created complexity-detection.md rules file with algorithm spec
- Added UI_PATTERNS for detecting UI components (8 patterns)
- Added DATA_PATTERNS for detecting data entities (6 patterns)
- Added INTERACTION_PATTERNS for detecting interactions (7 patterns)
- Added COMPLEXITY_LEVELS with 5 tiers (simple → very high)
- Added countEntityTypes() for entity diversity scoring
- Added extractEntities() for entity summary
- Added calculateComplexityScore() for overall score (0-100)
- Added analyzeTopicComplexity() for per-topic analysis
- Added groupRelatedTopics() for natural grouping
- Added generateEpicStructure() for epic recommendations
- Added recommendOutputStructure() for output type selection
- Added analyzeComplexity() main function
- Added CLI command: complexity [--json]
- Supports both human-readable and JSON output
**Files**:
- .claude/skills/transcript-digestion/rules/complexity-detection.md
- scripts/flow-transcript-digest.js

### R-012 | 2026-01-10 17:30
**Type**: new
**Tags**: #feature:transcript-digestion #story-generation #wf-4c237257-11
**Request**: "E3-S2: Story Template with Source Tracing"
**Result**: Implemented story generation with full source traceability:
- Created story-template.md rules file with traceability spec
- Added USER_TYPE_PATTERNS for user type detection
- Added SCENARIO_PATTERNS for scenario naming
- Added detectUserType() for automatic user detection
- Added extractObject(), extractActionFromText(), extractOutcomeFromText()
- Added extractGiven(), extractWhen(), extractThen() for Gherkin clauses
- Added generateCriteriaFromClarification() for clarification-derived criteria
- Added buildTraceabilityMatrix() for source tracking
- Added validateStoryCoverage() for coverage validation
- Added generateStoryFromTopic() for single topic story generation
- Added generateAllStories() for batch generation
- Added saveStory(), loadStory(), loadAllStories() for persistence
- Added formatStoryAsMarkdown() with source citations
- Added CLI commands: generate-story, generate-stories, show-story, list-stories, validate-stories
- Every acceptance criterion traces back to source statement or clarification
**Files**:
- .claude/skills/transcript-digestion/rules/story-template.md
- scripts/flow-transcript-digest.js

### R-013 | 2026-01-10 18:00
**Type**: new
**Tags**: #feature:transcript-digestion #presentation #wf-4c237257-12
**Request**: "E3-S3: One-by-One Presentation Flow"
**Result**: Implemented one-by-one story presentation with approval workflow:
- Created presentation-flow.md rules file with flow diagram and queue state structure
- Added loadQueue(), saveQueue() for queue persistence
- Added initializePresentation() for queue creation from generated stories
- Added getPresentationStatus() for progress tracking
- Added getNextStory() with auto-initialization and pending/skipped handling
- Added getCurrentStory() for retrieving current story being presented
- Added approveCurrentStory() for approving stories
- Added rejectCurrentStory(reason) for rejecting with reason capture
- Added skipCurrentStory() for deferring stories
- Added formatStorySummary() for compact presentation view
- Added formatActionsPrompt() for action menu
- Added getCompletionSummary() for final approval/rejection summary
- Added resetPresentation() for starting over
- Added CLI commands: present, approve, reject, skip, view-current, presentation-status, reset-presentation, completion-summary
- Stories auto-advance after approval/rejection/skip
- Completion shows summary box with approved/rejected/skipped counts
**Files**:
- .claude/skills/transcript-digestion/rules/presentation-flow.md
- scripts/flow-transcript-digest.js

### R-014 | 2026-01-10 18:50
**Type**: new
**Tags**: #feature:transcript-digestion #edit #wf-4c237257-13
**Request**: "E3-S4: Edit and Change Handling"
**Result**: Implemented story editing with full change tracking:
- Created edit-handling.md rules file with edit flow diagram
- Added loadEditSessions(), saveEditSessions() for session persistence
- Added startEditSession() to begin editing a story
- Added getActiveEditSession() to get current edit session
- Added recordChange() for tracking modifications
- Added editUserStory() for editing user story fields (user_type, action, benefit)
- Added editCriterion() for editing acceptance criteria (scenario, given, when, then)
- Added addCriterion() for adding new acceptance criteria
- Added removeCriterion() for removing criteria with reason
- Added validateEditedStory() for validating edits before commit
- Added recalculateCoverage() for updating coverage after manual edits
- Added updateQueueAfterEdit() to return edited stories to pending
- Added commitEditSession() to finalize edits and update queue
- Added cancelEditSession() to discard changes
- Added getEditChanges() to view pending changes
- Added getEditHistory() to view edit history for a story
- Added listEditableStories() to list rejected/approved/skipped stories
- Added CLI commands: edit-story, edit-user-story, edit-criterion, add-criterion, remove-criterion, edit-changes, commit-edit, cancel-edit, edit-history, list-editable
- Full change audit trail with before/after values
- Validation before commit with error/warning reporting
**Files**:
- .claude/skills/transcript-digestion/rules/edit-handling.md
- scripts/flow-transcript-digest.js

### R-015 | 2026-01-10 14:56
**Type**: new
**Tags**: #feature:transcript-digestion #integration #wf-4c237257-14
**Request**: "E3-S5: ready.json Integration"
**Result**: Implemented ready.json integration for exporting approved stories:
- Created ready-json-integration.md rules file
- Added generateWorkflowId() for wf-XXXXXXXX IDs
- Added generateSubTaskId() for sub-task IDs
- Added mapPriority() for complexity-to-priority mapping
- Added formatUserStoryDescription() for user story formatting
- Added convertStoryToTask() for story-to-task conversion
- Added validateForExport() for pre-export validation
- Added exportApprovedStories() for exporting approved stories
- Added createFeatureTask() for feature grouping
- Added addTasksToReadyJson() with duplicate detection
- Added formatTaskAsMarkdown() for markdown export
- Added exportStoryFiles() for .md file export
- Added previewExport() for preview what would be exported
- Added finalizeDigestion() to complete digestion process
- Added CLI commands: export-preview, export-approved, finalize
- Full source traceability preserved in exported tasks
- Duplicate prevention by story_id matching
**Files**:
- .claude/skills/transcript-digestion/rules/ready-json-integration.md
- scripts/flow-transcript-digest.js

### R-016 | 2026-01-10 15:10
**Type**: new
**Tags**: #feature:transcript-digestion #detection #wf-4c237257-15
**Request**: "E4-S1: Large Input Detection"
**Result**: Implemented enhanced large input detection:
- Created large-input-detection.md rules file
- Added measureInputMetrics() for detailed size metrics (words, chars, lines, paragraphs, tokens)
- Added estimateTokens() for LLM token estimation with code/timestamp adjustments
- Added VTT format detection (isVTTFormat) with WEBVTT header and timestamp patterns
- Added SRT format detection (isSRTFormat) with comma-separated timestamps
- Added meeting format detection (detectMeetingFormat) for

### R-017 | 2026-01-10 15:25
**Type**: new
**Tags**: #feature:transcript-digestion #classification #wf-4c237257-16
**Request**: "E4-S2: Content Type Classification"
**Result**: Implemented multi-label content type classification:
- Created content-type-classification.md rules file
- Added CONTENT_TYPE_PATTERNS for 9 content types:
  - transcript, requirements, technical_spec, meeting_notes
  - user_story, bug_report, documentation, email_thread, code
- Added PATTERN_WEIGHTS for scoring calibration
- Added PROCESSING_RECOMMENDATIONS for each content type
- Added scoreContentType() for per-type scoring with evidence
- Added normalizeScore() for length-normalized confidence
- Added classifyContentTypes() for multi-label classification
- Added getDetailedClassification() for full evidence output
- Added shouldExcludeContent() for digestion exclusion check
- Added CLI 'classify' command with verbose mode
- Added CLI 'recommend' command for processing recommendation
- Evidence extraction with sample matches
- Processing action recommendations (full_digestion, story_generation, skip, etc.)
**Files**:
- .claude/skills/transcript-digestion/rules/content-type-classification.md
- scripts/flow-transcript-digest.js

### R-018 | 2026-01-10 19:30
**Type**: new
**Tags**: #feature:transcript-digestion #parsing #vtt #srt #wf-4c237257-17
**Request**: "E4-S3: VTT/SRT Format Parsing"
**Result**: Implemented VTT and SRT subtitle format parsing:
- Created vtt-srt-parsing.md rules file with format specs and parsing flow
- Added timestampToMs() for timestamp to milliseconds conversion
- Added msToTimestamp() for milliseconds to human-readable timestamp
- Added cleanSubtitleText() for HTML tag and entity removal
- Added extractVTTSpeaker() for VTT voice tag parsing (<v Speaker>)
- Added extractSpeaker() for common speaker patterns (colon, brackets)
- Added parseVTT() for WebVTT format parsing (header, metadata, cues)
- Added parseSRT() for SRT format parsing (cue numbers, timestamps)
- Added finalizeCue() for cue object normalization
- Added mergeCues() for consecutive same-speaker cue merging
- Added parseSubtitle() for auto-detect VTT/SRT format
- Added formatCuesAsText() with timestamp/speaker options
- Added getSubtitleStats() for cue count, duration, speakers
- Added CLI 'parse-vtt' command with --json, --stats, --timestamps, --speakers, --no-merge
- Added CLI 'parse-srt' command with same options
- Added CLI 'parse-subtitle' for auto-detection with error handling
- Updated help text and module.exports
**Files**:
- .claude/skills/transcript-digestion/rules/vtt-srt-parsing.md
- scripts/flow-transcript-digest.js

### R-019 | 2026-01-10 20:00
**Type**: new
**Tags**: #feature:transcript-digestion #parsing #zoom #teams #wf-4c237257-18
**Request**: "E4-S4:

### R-020 | 2026-01-10 20:30
**Type**: new
**Tags**: #feature:transcript-digestion #language-detection #i18n #wf-4c237257-19
**Request**: "E5-S1: Language Detection"
**Result**: Implemented comprehensive language detection system:
- Created language-detection.md rules file with detection flow and specs
- Added SCRIPT_PATTERNS for 11 character set types (Latin, Cyrillic, Hebrew, Arabic, CJK, etc.)
- Added LANGUAGE_INFO metadata for 23 languages with script type, RTL flag, tier level
- Added COMMON_WORDS for 9 languages (en, es, fr, de, pt, it, nl, he, ru)
- Added TRIGRAM_PROFILES for 4 Tier 1 languages (en, es, fr, de)
- Added detectScript() for character set analysis
- Added cleanForDetection(), extractWords() for text preprocessing
- Added analyzeCommonWords(), extractTrigrams(), analyzeNgrams() for scoring
- Added combineLanguageScores() with weighted formula (50% script + 30% words + 20% ngrams)
- Added detectLanguage() for primary language with confidence score
- Added detectMultipleLanguages() for mixed-language content with segment analysis
- Added getLanguageInfo(), listSupportedLanguages() for language metadata
- Added CLI 'detect-language', 'detect-languages', 'language-info' commands
- Options: --json, -v/--verbose, --segment-size
- Fixed CLI flag handling for language-info --json without language code
- Updated help text and module.exports
**Files**:
- .claude/skills/transcript-digestion/rules/language-detection.md
- scripts/flow-transcript-digest.js

### R-021 | 2026-01-10 21:00
**Type**: new
**Tags**: #feature:transcript-digestion #i18n #multi-language #wf-4c237257-20
**Request**: "E5-S2: Multi-language Clarification"
**Result**: Implemented language-aware question generation and clarification:
- Created multi-language-clarification.md rules file with flow and templates
- Added QUESTION_TEMPLATES_BY_LANGUAGE with templates for en, es, he, fr, de
- Added getQuestionTemplates() to get templates for a specific language
- Added generateLocalizedQuestion() with fallback to English for unsupported languages
- Added detectSessionLanguage() to detect and store session language
- Added getTopicLanguage() to detect language for a topic's statements
- Added setLanguagePreference() to set user's preferred language
- Added getEffectiveLanguage() to determine language priority for question generation
- Added getSessionLanguageInfo() to retrieve all language settings
- Added CLI 'set-language' command to set preferred language
- Added CLI 'show-language' command to show current language settings
- Added CLI 'detect-session-language' command to detect and store language
- Options: --json
- Fixed fallback flag in generateLocalizedQuestion for unsupported languages
- Updated help text and module.exports
**Files**:
- .claude/skills/transcript-digestion/rules/multi-language-clarification.md
- scripts/flow-transcript-digest.js

### R-022 | 2026-01-10 21:45
**Type**: new
**Tags**: #feature:transcript-digestion #persistence #recovery #wf-4c237257-21
**Request**: "E5-S3: Session Persistence (Durable Digest)"
**Result**: Implemented durable digest session persistence for cross-context recovery:
- Created durable-digest.md rules file with session structure and flow
- Added DURABLE_DIGEST_PATH constant pointing to .workflow/state/durable-digest.json
- Added loadDurableSessions(), saveDurableSessions() for file I/O
- Added upsertDurableSession() to create/update session entries
- Added getSessionProgress() to calculate progress from actual files
- Added registerDurableSession() to register new sessions durably
- Added updateDurableProgress() to sync progress with files
- Added createDurableCheckpoint() for automatic checkpoint creation
- Added listDurableSessions() with status filtering
- Added getDurableSession() to retrieve session with updated progress
- Added switchDurableSession() to change active session
- Added updateRecoveryContext() to track recovery state
- Added generateRecoverySummaryForSession() for recovery context
- Added getTimeSince() for human-readable time formatting
- Added determineNextAction() to suggest next command
- Added archiveDurableSession(), deleteDurableSession(), completeDurableSession()
- Added CLI 'sessions' command to list all sessions
- Added CLI 'session-info' command to show session details
- Added CLI 'switch-session' command to change active session
- Added CLI 'session-recovery' command for recovery summary
- Added CLI 'archive-session', 'delete-session' commands
- Options: --json, --status=<filter>, --delete-files
- Updated help text and module.exports
**Files**:
- .claude/skills/transcript-digestion/rules/durable-digest.md
- scripts/flow-transcript-digest.js

### R-023 | 2026-01-10 22:30
**Type**: new
**Tags**: #skill:transcript-digestion #feature:chunking
**Request**: "E5-S4: Large Transcript Chunking"
**Result**: Implemented large transcript chunking functionality to handle transcripts exceeding context limits.
- Created .claude/skills/transcript-digestion/rules/large-transcript-chunking.md rules file
- Added CHUNKING_DEFAULTS constant with thresholds (10K words, 15K tokens, 50K chars)
- Added SPEAKER_BOUNDARY_PATTERNS for natural boundary detection
- Added needsChunking() to check if transcript exceeds thresholds
- Added splitIntoSentences() utility for sentence-based splitting
- Added findNaturalBoundary() to find speaker changes, paragraphs, sentences
- Added planChunks() to calculate optimal chunk boundaries
- Added createChunks() to actually create chunks with overlap
- Added normalizeTopicTitle(), normalizeStatement() for deduplication
- Added mergeChunkTopics(), mergeChunkStatements() for result merging
- Added initializeChunkingState(), loadChunkingState(), saveChunkingState()
- Added updateChunkStatus(), getChunkContent(), getChunkingStatus()
- Added CLI 'needs-chunking' command to check if chunking needed
- Added CLI 'plan-chunks' command to plan chunk boundaries
- Added CLI 'chunk-status' command to show chunking progress
- Options: --json, --target-words <n>
- Updated help text and module.exports
**Files**:
- .claude/skills/transcript-digestion/rules/large-transcript-chunking.md
- scripts/flow-transcript-digest.js

### R-025 | 2026-01-10 23:30
**Type**: new
**Tags**: #feature:droid-improvements #workflow #wf-droid-imp
**Request**: "Implement Factory AI Droid Improvements (6 Priorities)"
**Result**: Implemented comprehensive Droid-inspired improvements across 6 priorities:

**Priority 1 - Model-Invoked Skills:**
- Created scripts/flow-skill-matcher.js - automatic skill matching based on task context
- Added default triggers for all installed skills (nestjs, react, python, figma-analyzer, transcript-digestion)
- Skills auto-load patterns.md, anti-patterns.md, learnings.md
- Added config.skills.autoInvoke setting

**Priority 2 - Mandatory Specification Mode:**
- Created scripts/flow-spec-generator.js - generates specs before implementation
- Specs include: acceptance criteria, implementation steps, files to change, test strategy, verification commands
- Added config.specificationMode settings (mandatory for medium/large tasks)
- Specs saved to .workflow/specs/<task-id>.md and .json

**Priority 3 - Structured Execution Loop:**
- Implemented Spec → Test → Implement → Verify four-phase loop
- Each phase produces file-based artifacts
- Loop state saved to .workflow/verifications/loops/

**Priority 4 - File-Based Validation:**
- Created scripts/flow-verification.js - file-based verification system
- Every verification run saves JSON artifact with exit codes, output, pass/fail
- Verification log maintained in .workflow/verifications/verification-log.md
- Commands: runVerification(), saveVerificationResult(), executeStructuredLoop()

**Priority 5 - Better Code Understanding:**
- Created scripts/flow-code-intelligence.js - enhanced code analysis
- Import/export relationship mapping
- Type dependency tracking
- Function extraction and call graph building
- Smart context loading based on relationships
- Commands: analyzeRelationships(), buildDependencyGraph(), findRelatedCode()

**Priority 6 - Self-Reflection Checkpoints:**
- Added reflection checkpoints at key points (post-spec, post-implementation, pre-completion)
- Reflection questions stored in .workflow/verifications/reflections/
- Commands: createReflectionCheckpoint(), recordReflectionAnswer()

**Updated wogi-start.md command:**
- Integrated skill auto-loading display
- Added spec generation phase for medium/large tasks
- Added reflection checkpoints with questions
- Updated output format to show verification artifacts
- Added new options: --no-spec, --no-skills, --no-reflection, --verify-only

**Files**:
- scripts/flow-skill-matcher.js (new)
- scripts/flow-spec-generator.js (new)
- scripts/flow-verification.js (new)
- scripts/flow-code-intelligence.js (new)
- .claude/commands/wogi-start.md
- .workflow/config.json
- .gitignore
- .workflow/specs/.gitkeep (new)
- .workflow/verifications/.gitkeep (new)

### R-096 | 2026-01-30
**Type**: new
**Tags**: #workflow #browser-testing #chrome-integration #testing
**Task**: wf-9d449855
**Request**: "Implement browser test execution with Chrome integration and smart failure suggestions"
**Result**: Completed browser testing feature:
- Created `flow-browser-executor.js` with Chrome connection check and MCP tool mapping
- Maps flow steps: navigate→browser_navigate, click→browser_click, type→browser_type, etc.
- Added result tracking and screenshot capture on failure
- Updated `claude-md.hbs` with semantic browser test suggestion guidance (no pattern matching)
- Updated `/wogi-test-browser` command with full documentation
- Added `shouldSuggestAfterTask()` for auto-suggestion after UI task completion
**Files**: scripts/flow-browser-executor.js, scripts/flow-browser-suggest.js, .claude/commands/wogi-test-browser.md, .workflow/templates/claude-md.hbs
**Note**: Uses Claude's natural language understanding to suggest tests, not regex/keywords

### R-095 | 2026-01-30
**Type**: change
**Tags**: #workflow #learning-system #decisions #critical
**Task**: wf-learning-001
**Request**: "Expand Self-Correction Protocol into comprehensive learning system"
**Result**: Replaced basic "Repeated Issue Detection" rule with comprehensive "Continuous Learning Protocol":
- Part 1: Pre-Task Pattern Check (check learning files BEFORE starting work)
- Part 2: Post-Failure Capture (record ALL failures, not just when user is frustrated)
- Part 3: User Frustration Detection (escalation when Parts 1-2 failed)
- Added self-diagnosis questions to ask after every failure
- Added table of failure types to track
**Files**: .workflow/state/decisions.md, .workflow/templates/claude-md.hbs, CLAUDE.md
**Root Cause**: GitHub release failures happened 10+ times because I wasn't using the learning system - didn't check feedback-patterns.md before starting operational tasks.

### R-094 | 2026-01-30
**Type**: new
**Tags**: #workflow #documentation #operations #learning
**Task**: wf-f698b7fb
**Request**: "Add GitHub release workflow rule to prevent race condition failures"
**Result**: Created `.claude/rules/operations/github-releases.md` documenting:
- Root cause: race condition when `git push` + `gh release create` run in sequence
- Correct procedure: create tag locally, push tag, then create release
- Recovery procedure for failed releases
- Verification commands
**Files**: .claude/rules/operations/github-releases.md
**Learning**: This rule was created after 10+ npm publish failures. Previous sessions didn't learn because the pattern wasn't persisted to any file loaded at session start.

### R-093 | 2026-01-30
**Type**: new
**Tags**: #workflow #background-tasks #crush-research
**Task**: wf-80c41aef
**Request**: "Add background task execution for non-blocking operations"
**Result**: Created `flow-background.js` for running maintenance tasks in background:
- Available tasks: memory-compact, skill-learn, aggregate, knowledge-sync, entropy-check, mcp-docs
- Detached process execution with logging to `.workflow/logs/`
- Timeout handling and state persistence to `background-tasks.json`
- CLI: run, status, list, cancel, logs commands
**Files**: scripts/flow-background.js, scripts/flow

### R-092 | 2026-01-30
**Type**: new
**Tags**: #workflow #mcp #documentation #crush-research
**Task**: wf-e444ecc5
**Request**: "Add auto-generated tool documentation for MCP tools"
**Result**: Created `flow-mcp-docs.js` for MCP tool documentation:
- Scans MCP servers using regex-based extraction
- Generates markdown with PIN markers for context loading
- Provides task-based tool recommendations
- Found 13 tools across 2 servers (memory: 9, figma: 4)
- CLI: scan, list, show, generate, context commands
**Files**: scripts/flow-mcp-docs.js, scripts/flow, .claude/docs/knowledge-base/05-development-tools/mcp-tools-generated.md

### R-091 | 2026-01-30
**Type**: new
**Tags**: #workflow #permissions #crush-research
**Task**: wf-0bff91f3
**Request**: "Implement permission persistence with session vs permanent choice"
**Result**: Created `flow-permissions.js` for permission tracking:
- Session scope (in-memory, cleared on session end)
- Permanent scope (persisted to permissions.json)
- Wildcard matching for path-based permissions (e.g., "create-file:src/**")
- Integration with session-end for automatic cleanup
- CLI: list, grant, revoke, check, clear-session commands
**Files**: scripts/flow-permissions.js, scripts/flow-session-end.js, scripts/flow

### R-090 | 2026-01-30
**Type**: new
**Tags**: #task-management #testing #flow-story #dry-run
**Task**: wf-3430d135
**Request**: "Add --dry-run flag to flow story to prevent test task pollution"
**Result**: Added --dry-run flag to `flow story` command that:
1. Previews what would be created without writing files
2. Skips adding tasks to ready.json
3. Shows clear "[DRY RUN]" indicators in output
4. Displays summary showing no files were created
Also cleaned up orphaned test tasks (wf-0873ce64 and subtasks) and their files from `.workflow/changes/`
**Files**: scripts/flow-story.js, .workflow/state/ready.json

### R-089 | 2026-01-29
**Type**: refactor
**Tags**: #cleanup #cli-simplification #maintenance
**Task**: wf-a768cafc
**Request**: "Remove non-Claude CLI support - simplify to Claude Code only"
**Result**: Removed all non-Claude CLI support (~5,000+ lines deleted) to simplify maintenance:
- Deleted bridge files: gemini-bridge.js, cursor-bridge.js, opencode-bridge.js, codex-bridge.js, kimi-bridge.js
- Deleted templates: gemini-md.hbs, cursor-rules.mdc.hbs, opencode-*.hbs, codex-config.hbs, kimi-agents-md.hbs
- Deleted documentation: gemini-cli.md, cursor.md, opencode.md, codex.md, kimi.md
- Deleted hook adapters: gemini.js, cursor.js, opencode.js and entry directories
- Updated bridges/index.js, flow-bridge-state.js, hooks/adapters/index.js
- Updated config.json and config.schema.json to only support claude-code
- Updated flow-bridge.js, flow-health.js, installer.js, postinstall.js
**Files**: 20+ files deleted, 10+ files modified

### R-088 | 2026-01-29
**Type**: fix
**Tags**: #security #code-quality #code-review
**Task**: wf-193b740e
**Request**: "Fix code review issues in flow-capture.js and flow-bulk-orchestrator.js"
**Result**: Fixed 6 issues identified in code review:
1. **CRITICAL**: Added try-catch around writeFileSync in flow-capture.js (addToDiscussionQueue, addToRoadmap)
2. **HIGH**: Moved fs/path requires to module level in flow-capture.js
3. **HIGH**: Escaped user input in RegExp construction (todayHeader)
4. **MEDIUM**: Used try/finally for signal listener cleanup in continuousWorkLoop
5. **MEDIUM**: Validated CLI --idle-timeout argument for NaN
6. **LOW**: Changed let to const for totalCompleted/totalSkipped arrays
**Files**: scripts/flow-capture.js, scripts/flow-bulk-orchestrator.js

### R-087 | 2026-01-29
**Type**: new
**Tags**: #workflow #wogi-bulk #continuous-mode #orchestrator #matt-maher
**Task**: wf-continuous-01
**Request**: "Continuous Work Loop for /wogi-bulk"
**Result**: Implemented v3.1 continuous mode for /wogi-bulk:
1. **continuousWorkLoop()**: Keeps checking for new tasks instead of stopping
2. **Idle handling**: Configurable idleAction (stop/wait), idleTimeout, maxIdleChecks
3. **Graceful shutdown**: SIGINT/SIGTERM handlers complete current work before stopping
4. **CLI commands**: `continuous`, `check` commands added
5. All 5 acceptance criteria verified:
   - Continue when new tasks appear ✓
   - Stop when truly empty (after maxIdleChecks) ✓
   - Configurable idle behavior ✓
   - Manual stop with Ctrl+C ✓
   - Disable via config ✓
**Files**:
- scripts/flow-bulk-orchestrator.js (v3.1 with continuous loop)
- .claude/commands/wogi-bulk.md (continuous mode docs)

### R-086 | 2026-01-29
**Type**: new
**Tags**: #workflow #wogi-capture #routing #certainty-detection #matt-maher
**Task**: wf-capture-route-01
**Request**: "Capture Routing - Certain vs Uncertain Ideas"
**Result**: Implemented v2.1 routing for /wogi-capture:
1. **Certainty detection**: Auto-detects uncertainty from question marks, "maybe", "should we", etc.
2. **Routing logic**: Certain → roadmap.md, Uncertain → discussion-queue.md
3. **Explicit flags**: --certain, --idea, --no-route
4. **Discussion queue**: New file format with date-based sections
5. All 5 acceptance criteria verified:
   - Certain idea → roadmap ✓
   - Uncertain idea → discussion queue ✓
   - --certain flag forces roadmap ✓
   - --idea flag forces discussion ✓
   - Auto-detect from text patterns ✓
**Files**:
- scripts/flow-capture.js (v2.1 with routing)
- .claude/commands/wogi-capture.md (updated docs)
- .workflow/config.json (routing section)
- .workflow/config.schema.json (routing schema)

### R-085 | 2026-01-29
**Type**: new
**Tags**: #workflow #wogi-capture #auto-grouping #matt-maher
**Task**: wf-capture-group-01
**Request**: "Smart Capture with Auto-Grouping - related ideas stay together, unrelated split"
**Result**: Implemented v2.0 of /wogi-capture with auto-grouping:
1. **Multi-item parsing**: Splits input by commas, "and", numbered lists
2. **Semantic analysis**: Extracts action type (color, size, text, bugfix) and target (button, header, form)
3. **Similarity scoring**: Combines items with same action type + target
4. **Configurable**: autoGroup, groupingThreshold, maxGroupSize in config.json
5. All 4 acceptance criteria verified:
   - Related items (button colors) → grouped into ONE capture
   - Unrelated items (bug, feature, update) → split into THREE captures
   - Mixed → color changes grouped, bug fix separate
   - Single item → passes through unchanged
**Files**:
- scripts/flow-capture.js (v2.0 with grouping)
- .claude/commands/wogi-capture.md (updated docs)
- .workflow/config.json (capture section)
- .workflow/config.schema.json (capture schema)

### R-084 | 2026-01-29
**Type**: new
**Tags**: #workflow #wogi-bulk #orchestrator #sub-agents #parallel-execution
**Task**: wf-orchestrator-01
**Request**: "Add orchestrator pattern to /wogi-bulk for sub-agent task execution"
**Result**: Implemented Matt Maher's "do-work" orchestrator pattern:
1. **Core Module** (scripts/flow-bulk-orchestrator.js):
   - `orchestrateBulk()` - Main entry point, returns execution plan
   - `buildExecutionBatches()` - Groups independent tasks for parallel execution
   - `generateCompletionSummary()` - Creates pass-forward summaries for dependent tasks
   - `formatSummariesForContext()` - Formats summaries for sub-agent context
   - `handleTaskFailure()` - Configurable failure handling (stop-all, stop-dependent, continue)
2. **Configuration** added to config.json/schema:
   - `bulkOrchestrator.enabled` - Toggle orchestrator mode
   - `bulkOrchestrator.parallelLimit` - Max parallel tasks
   - `bulkOrchestrator.onFailure` - Failure handling mode
   - `bulkOrchestrator.summaryDepth` - Summary detail level
3. **Documentation** updated in wogi-bulk.md:
   - v3.0 orchestrator mode with execution flow diagram
   - Pass-forward summaries explanation
   - New options: --no-orchestrator, --on-failure, --summary-depth
**Files**:
- scripts/flow-bulk-orchestrator.js (new)
- .claude/commands/wogi-bulk.md
- .workflow/config.json
- .workflow/config.schema.json
- .workflow/changes/bulk-orchestrator/wf-orchestrator-01.md

### R-083 | 2026-01-29
**Type**: new
**Tags**: #workflow #plan-mode #wogi-start #claude-code-integration
**Task**: wf-planmode-01
**Request**: "Add Plan Mode-inspired improvements to /wogi-start: Explore Phase and Explicit Approval Gate"
**Result**: Implemented two Claude Code Plan Mode-inspired improvements:
1. **Explore Phase (Step 1.3)**: Read-only analysis phase for L1/L0 tasks before spec generation
   - Uses Glob/Grep/Read tools only (no editing)
   - Finds related files, checks app-map and decisions.md
   - Maps dependencies and surfaces assumptions
   - Structured output format with related files, components, patterns
2. **Explicit Approval Gate (Step 1.6)**: Requires user approval for Stories/Epics
   - Displays spec and STOPS until approval received
   - Supports multiple approval phrases (approved, proceed, lgtm, etc.)
   - Prevents wasted implementation on misunderstood requirements
3. **Config options** added to config.schema.json under `planMode`:
   - `explorePhase.enabled`, `explorePhase.minTaskLevel`
   - `approvalGate.enabled`, `approvalGate.minTaskLevel`, `approvalGate.approvalPhrases`
4. Updated execution flow diagram to v2.3 showing new steps
**Files**:
- .claude/commands/wogi-start.md
- .workflow/config.schema.json
- .workflow/changes/general/wf-planmode-01.md

### R-082 | 2026-01-28
**Type**: new
**Tags**: #cli-bridges #auto-sync #multi-cli #workflow
**Task**: wf-bridge-001
**Request**: "Complete CLI bridge auto-sync and multi-CLI support"
**Result**: Implemented comprehensive CLI bridge auto-sync system:
- Enhanced flow-bridge-state.js with:
  - templateHash tracking for template change detection
  - markSynced() function per spec requirements
  - hasConfigChanged() for global config change detection
  - getSyncStatus() for all CLIs overview
  - clearSyncState() for debugging/reset
- Created kimi-agents-md.hbs template for Kimi CLI
- Verified auto-sync already wired to all session-start hooks (Claude Code, Gemini CLI, Cursor, OpenCode)
- Updated config.json to enable multiple CLIs (claude-code, gemini-cli)
- Tested sync-all command successfully syncing both enabled CLIs
- State file now tracks config hash, template hash, and last sync per CLI
**Files**:
- scripts/flow-bridge-state.js
- .workflow/templates/kimi-agents-md.hbs
- .workflow/config.json
- .workflow/state/bridge-sync.json

### R-081 | 2026-01-28
**Type**: change
**Tags**: #enforcement #session-start #bypass-tracking #workflow
**Task**: wf-enforce-001-06
**Request**: "Add session-start bypass reminder"
**Result**: Integrated bypass reminders into session-context.js:
- Added imports for getBypassTracking, hasWorkflowBypasses
- Added bypassReminder to gatherSessionContext() when warnOnBypass enabled
- Added "Workflow Bypass Reminder" section to formatContextForInjection()
- Shows bypass count and auto-created tasks
- Includes trust reminder message
**Files**:
- scripts/hooks/core/session-context.js

### R-080 | 2026-01-28
**Type**: change
**Tags**: #enforcement #status #bypass-tracking #workflow
**Task**: wf-enforce-001-05
**Request**: "Add bypass warnings to /wogi-status"
**Result**: Integrated bypass warnings into flow-status.js:
- Added imports for getBypassTracking, hasWorkflowBypasses, getBypassSummary
- Added bypassTracking to collectStatus() data collection
- Added "Workflow Bypasses" section to human-readable output
- Shows count, auto-created tasks, and recent attempts
- Includes helpful tip about using /wogi-start
- Bypass data also included in JSON output
**Files**:
- scripts/flow-status.js

### R-079 | 2026-01-28
**Type**: change
**Tags**: #enforcement #template #documentation #workflow
**Task**: wf-enforce-001-04
**Request**: "Update CLAUDE.md template with violation section"
**Result**: Added comprehensive "WORKFLOW VIOLATIONS" section to claude-md.hbs template:
- Lists specific violation types with examples
- Explains why auto-created tasks are still violations
- Details bypass tracking and visibility
- Shows correct vs incorrect patterns
- Only appears when strictMode is enabled
**Files**:
- .workflow/templates/claude-md.hbs

### R-078 | 2026-01-28
**Type**: new
**Tags**: #enforcement #session-state #bypass-tracking #workflow
**Task**: wf-enforce-001-03
**Request**: "Add bypass tracking to session state"
**Result**: Implemented comprehensive bypass tracking:
- Added `bypassTracking` section to session state (count, attempts[], autoCreatedTasks[])
- Added `trackBypassAttempt()` to record bypass attempts with details
- Added `getBypassTracking()` to retrieve bypass data
- Added `hasWorkflowBypasses()` quick check function
- Added `getBypassSummary()` for formatted display of bypasses
- Added `clearBypassTracking()` to reset after acknowledgment
- Integrated trackBypassAttempt into task-gate.js for automatic recording
**Files**:
- scripts/flow-session-state.js
- scripts/hooks/core/task-gate.js

### R-077 | 2026-01-28
**Type**: change
**Tags**: #enforcement #task-gating #hooks #workflow
**Task**: wf-enforce-001-02
**Request**: "Modify task-gate.js to block instead of auto-create"
**Result**: Updated checkTaskGate() to respect new config options:
- Check `autoCreateTask` config before auto-creating tasks (default: false)
- When autoCreateTask is false, block the edit entirely
- Added support for `blockAutoTask` enforcement layer (creates task for tracking but blocks edit)
- Added new reason codes: `auto_task_blocked` for blocked auto-tasks
- Improved block message to guide users to /wogi-start
**Files**:
- scripts/hooks/core/task-gate.js

### R-076 | 2026-01-28
**Type**: new
**Tags**: #enforcement #config #task-gating #workflow
**Task**: wf-enforce-001-01
**Request**: "Add config options for strict enforcement to prevent AI from bypassing workflow"
**Result**: Added new config options to enforce workflow discipline:
- Added `enforcement.blockAutoTask: true` - Block edits even when auto-task is created
- Added `enforcement.warnOnBypass: true` - Display warnings when bypasses detected
- Added `hooks.rules.taskGating.autoCreateTask: false` - Disable auto-creation of tasks
- Updated config.schema.json with documentation for all new options
**Files**:
- .workflow/config.json
- .workflow/config.schema.json

### R-075 | 2026-01-27
**Type**: new
**Tags**: #bridge #kimi #cli #security #multi-cli
**Request**: "Comprehensive code review of CLI bridges, fix all issues, add Kimi CLI support"
**Result**: Multi-pass code review with security fixes and new CLI bridge:
- Fixed CRITICAL: Variable redeclaration in opencode-bridge.js (lines 469, 483)
- Fixed HIGH: TOCTOU race conditions in 5 bridges (removed fs.existsSync, use try-catch)
- Fixed HIGH: Missing path bounds check in kimi-bridge.js
- Fixed HIGH: Unvalidated JSON.parse in gemini-bridge.js
- Fixed HIGH: TOML escaping order in gemini-bridge.js (backslashes first)
- Fixed MEDIUM: Null byte validation in cursor.js safeStringArray
- Fixed MEDIUM: JSON object validation in before-submit-prompt.js
- Created kimi-bridge.js for MoonshotAI Kimi CLI (soft parity only)
- Added Bridge Parity Rule to decisions.md with mandatory checklist
- Updated supported CLIs list (Claude Code, Cursor, Gemini, OpenCode have hard enforcement; Codex, Kimi have soft parity)
**Files**:
- .workflow/bridges/opencode-bridge.js
- .workflow/bridges/kimi-bridge.js (new)
- .workflow/bridges/gemini-bridge.js
- .workflow/bridges/codex-bridge.js
- .workflow/bridges/cursor-bridge.js
- .workflow/bridges/index.js
- scripts/hooks/adapters/cursor.js
- scripts/hooks/entry/cursor/before-submit-prompt.js
- .workflow/state/decisions.md

### R-074 | 2026-01-27
**Type**: new
**Tags**: #feature #cross-session #learning #pattern-detection
**Request**: "Add cross-session pattern detection and enforcement"
**Result**: Implemented system to detect repeated requests across sessions and offer to enforce them as permanent rules:
- Added `getAllRequestEntries()` to flow-log-manager.js for loading entries across archives
- Added `detectCrossSessionPatterns()` to flow-session-learning.js with semantic similarity matching
- Added cross-session enforcement functions to flow-pattern-enforcer.js
- Integrated into flow-session-end.js to detect patterns at session end
- Added `crossSessionLearning` configuration section
- Patterns are enforced to both decisions.md AND .claude/rules/
**Files**:
- scripts/flow-log-manager.js (getAllRequestEntries)
- scripts/flow-session-learning.js (detectCrossSessionPatterns)
- scripts/flow-pattern-enforcer.js (cross-session enforcement functions)
- scripts/flow-session-end.js (integration)
- .workflow/config.json (crossSessionLearning config)
- .claude/commands/wogi-session-end.md (documentation)

### R-073 | 2026-01-27
**Type**: new
**Tags**: #feature #claude-code #compatibility #task-management
**Request**: "Review Claude Code 2.1.20 changelog and update Wogi Flow"
**Result**: Analyzed 2.1.20 changes and added task cancellation with knowledge preservation:
- Added `cancelTask()` function to flow-utils.js for cancelling tasks while preserving history
- Cancelled tasks move to `recentlyCompleted` with metadata (reason, timestamp, workDone flag)
- Updated claude-code-compatibility.md with 2.1.20 features:
  - Task deletion capability (two-system approach documented)
  - Improved session compaction
  - Additional CLAUDE.md loading via --add-dir
  - PR review status indicator
  - Background agent permission changes
**Files**:
- scripts/flow-utils.js (added cancelTask function)
- .claude/docs/claude-code-compatibility.md (2.1.20 documentation)

### R-072 | 2026-01-25
**Type**: change
**Tags**: #docs #refactor #claude-code #compatibility
**Request**: "Review Claude Code 2.1.19 changelog and update Wogi Flow accordingly"
**Result**: Updated compatibility docs and refactored state cleanup:
- Documented CLAUDE_CODE_ENABLE_TASKS env var and 2.1.19 fixes
- Created `.claude/keybindings.json` with 7 recommended shortcuts
- Extracted `cleanupStaleState()` to shared `flow-state-cleanup.js` module
- Standardized error handling with DEBUG logging
- Added safe file write/delete helpers with proper error handling
- Reduced code duplication (~100 lines removed from each script)
**Files**:
- .claude/docs/claude-code-compatibility.md (modified)
- .claude/keybindings.json (new)
- scripts/flow-state-cleanup.js (new, 268 lines)
- scripts/flow-morning.js (modified - uses shared module)
- scripts/flow-session-end.js (modified - uses shared module)

### R-071 | 2026-01-23 11:00
**Type**: fix
**Tags**: #fix #code-quality #security #wf-41b39a4c
**Request**: "Fix all code review findings from R-070"
**Result**: Addressed all high-priority code review findings:
- Added `matchesAnyPattern()` helper function (DRY violation fix)
- Added `calculateConfidence()` helper function (standardized confidence)
- Added `sanitizeForDisplay()` function (security - redacts secrets from console)
- Added validation for classification result in `triageRequest()`
- Fixed quote stripping regex to require matching quotes
- Optimized `isQuestion` check order (check length before trim)
- Renamed `generateGuiltMessage()` to `generateWorkflowReminder()`
- Added try-catch around pattern matching (error handling)
- Added comprehensive JSDoc for `classifyRequest()`
- Made return structure consistent with `matches` array in all categories
**Files**:
- scripts/hooks/core/implementation-gate.js
- scripts/flow-start.js
- .workflow/reviews/2026-01-23-103000-review.md (updated)

### R-070 | 2026-01-23 10:30
**Type**: new
**Tags**: #feature #auto-routing #workflow #wogi-start #wf-41b39a4c
**Request**: "Universal /wogi-start entry point with auto-routing and guilt messaging"
**Result**: Made /wogi-start the single entry point for ALL requests with intelligent classification:
- Added pattern categories to `implementation-gate.js`: OPERATIONAL, BUG, QUICK_FIX
- Created `classifyRequest()` function for automatic request classification
- Updated `triageRequest()` in `flow-start.js` to use auto-routing
- Added guilt messaging for bug/implementation requests to enforce workflow discipline
- Updated `claude-md.hbs` with "CRITICAL: Universal Entry Point" section
- Updated `wogi-start.md` documentation with auto-routing behavior
- Categories: exploration→proceed, operational→execute, quick-fix→auto-task, bug→create-bug, implementation→create-story
**Files**:
- scripts/hooks/core/implementation-gate.js (classifyRequest, new patterns)
- scripts/flow-start.js (triageRequest rewrite)
- .workflow/templates/claude-md.hbs (universal entry point section)
- .claude/commands/wogi-start.md (auto-routing documentation)
- CLAUDE.md (regenerated)

### R-069 | 2026-01-22 22:41
**Type**: new
**Tags**: #feature #claude-code #todowrite #integration #wf-560d0ec5
**Request**: "Integrate with Claude Code native task features"
**Result**: Implemented TodoWrite sync for unified progress tracking with Claude Code:
- Created `flow-todowrite-sync.js` - Parses acceptance criteria, tracks progress via TodoWrite
- Modified `flow-start.js` - Added TodoWrite initialization at task start
- Modified `flow-done.js` - Added completion stats display and state cleanup
- Created `.claude/docs/claude-code-compatibility.md` - Compatibility documentation
- Code review: Fixed 14 issues (1 critical, 2 high, 11 medium/low)
- Security: Try-catch on file operations, extracted recalculateStats() helper
- Style: Removed emojis, standardized ID prefixes, refactored exports
- Released v1.0.45 to npm and GitHub
**Files**:
- scripts/flow-todowrite-sync.js (new)
- scripts/flow-start.js
- scripts/flow-done.js
- .claude/docs/claude-code-compatibility.md (new)

### R-068 | 2026-01-18 21:00
**Type**: new
**Tags**: #feature #spec-verification #quality-gate #wf-e0d502fe
**Request**: "Implement spec-verification gate to prevent implementation gaps"
**Result**: Implemented spec verification gate that blocks task completion when deliverables are missing:
- Created `flow-spec-verifier.js` with section-aware spec parsing
- Parses markdown tables, lists, code blocks for file paths
- Distinguishes real deliverables from example paths in acceptance criteria
- Validates JS/JSON syntax for new files
- Integrated into `/wogi-done` as mandatory pre-completion gate
- Added `--skip-spec-check` and `--force` bypass options
- Added config options: `tasks.requireSpecVerification`, `tasks.specVerification`
**Files**:
- scripts/flow-spec-verifier.js (new)
- scripts/flow-done.js (modified)
- .workflow/config.json (modified)
- .claude/commands/wogi-done.md (modified)
- .workflow/state/decisions.md (modified)

### R-067 | 2026-01-16 12:00
**Type**: new + fix
**Tags**: #feature #hybrid-mode #security #code-review #function-registry #api-registry
**Request**: "Optimize hybrid mode, add function/API registries, fix code review issues"
**Result**: Comprehensive hybrid mode optimization and security fixes:
- Added model registry integration to hybrid mode (17+ models from registry)
- Expanded cloud providers with custom model input support
- Added context window override config (32K-250K+) for local LLMs
- Removed artificial token limits for local LLMs (they're free!)
- Created function-index.js and api-index.js scanners
- Created flow-scanner-base.js with shared scanner utilities
- Created flow-semantic-match.js for hybrid similarity matching
- CRITICAL: API keys no longer stored in config (apiKey → apiKeyEnv)
- HIGH: Fixed RegExp injection via taskId (ReDoS prevention)
- HIGH: Fixed URL encoding for query parameters
- HIGH: Replaced JSON.parse with safeJsonParse
- Fixed e.stderr → err.stderr bug in flow-orchestrate.js
- Removed findSimilarComponentsLegacy dead code
**Files**:
- scripts/flow-hybrid-interactive.js
- scripts/flow-orchestrate.js
- scripts/flow-done.js
- scripts/flow-function-index.js (new)
- scripts/flow-api-index.js (new)
- scripts/flow-scanner-base.js (new)
- scripts/flow-semantic-match.js (new)
- scripts/hooks/core/component-check.js
- .workflow/config.json

### R-024 | 2026-01-10 16:20
**Type**: fix
**Tags**: #skill:transcript-digestion #bugfix #wf-07100113
**Request**: "Fix Critical Bugs in Transcript Digestion Skill"
**Result**: Fixed 5 critical bugs identified during code inspection:
1. **Null clarifications handling** (lines 3065-3077): Added null check and initialization in generateAllQuestions() to prevent crash when no clarifications file exists
2. **Infinite loop prevention** (lines 2446-2471): Added safety counter, lastIndex reset, and zero-width match handling in findNaturalBoundary() regex exec loop
3. **Empty orphans array guard** (lines 767-782): Added guard at start of createTopicFromOrphans() to return default topic when orphans array is empty
4. **VTT input validation** (parseVTT function): Added try/catch wrapper and input validation, returns error object for malformed input
5. **SRT input validation** (parseSRT function): Added try/catch wrapper and input validation, returns error object for malformed input
- All fixes follow defensive programming patterns
- Quality gates passed: syntax check, empty input handling, chunking
**Files**:
- scripts/flow-transcript-digest.js

### R-025 | 2026-01-11 00:10
**Type**: fix
**Tags**: #skill #triggers #wf-droid-gaps #droid-improvements
**Request**: "Address gaps in Droid improvements - add trigger metadata to skills"
**Result**: Added `## Triggers` sections to all 5 skill files per Factory AI Droid pattern:
- Each skill now has explicit trigger metadata
- Format: keywords, filePatterns, taskTypes, categories (YAML-like arrays)
- Enables model-invoked skill matching via flow-skill-matcher.js
- All triggers verified working with skill matcher tests
**Files**:
- .claude/skills/nestjs/skill.md
- .claude/skills/react/skill.md
- .claude/skills/python/skill.md
- .claude/skills/figma-analyzer/skill.md
- .workflow/state/ready.json

### R-026 | 2026-01-11 01:00
**Type**: fix
**Tags**: #security #critical #wf-474718e5 #code-review
**Request**: "Fix critical security vulnerabilities in wogi-flow"
**Result**: Fixed 5 critical/high security issues identified in code review:
1. Command injection in executeCommand() - added pattern validation
2. Unsafe eval in evaluateCondition() - replaced with safe whitelist parser
3. Poll command injection - added validation using shared patterns
4. Session timeout - added maxDurationMinutes check (default 120 min)
5. Ready.json race conditions - added async functions with file locking
Additionally verified that path traversal and dependency checking were already correct.
**Files**:
- scripts/flow-workflow.js
- scripts/flow-durable-session.js
- scripts/flow-utils.js

### R-027 | 2026-01-11 02:15
**Type**: fix
**Tags**: #bugfix #medium #wf-medium-fixes #code-review
**Request**: "Fix medium severity issues from code review"
**Result**: Fixed 8 medium severity issues:
1. Removed incomplete skills from default install (React/Python moved to comingSoon)
2. Updated CLAUDE.md with accurate state files documentation
3. Fixed Promise rejection handling in flow-parallel.js (callbacks in try-catch, allSettled)
4. Added robust lock cleanup mechanism in flow-utils.js (ENOENT handling, auto-cleanup on load)
5. Fixed off-by-one request ID bug (now uses highest ID + 1 instead of count)
6. Added input validation to flow-story.js (sanitizeFeatureName, path traversal protection)
7. Deprecated orphaned hybrid-session.json references (updated commands to use durable sessions)
8. Consolidated duplicate config keys (testing.* merged into browserTesting.*)
**Files**:
- .workflow/config.json
- CLAUDE.md
- scripts/flow-utils.js
- scripts/flow-parallel.js
- scripts/flow-story.js
- scripts/flow-orchestrate.js
- scripts/flow-install
- .claude/commands/wogi-hybrid-status.md
- .claude/commands/wogi-hybrid-setup.md

### R-028 | 2026-01-11 02:45
**Type**: fix
**Tags**: #bugfix #low #wf-low-fixes #code-review #cleanup
**Request**: "Fix low severity issues from code review"
**Result**: Fixed 6 low severity issues:
1. Extracted magic numbers into named constants in flow-utils.js (timeouts, lock thresholds, retries)
2. Added constants exports for reuse across modules
3. Updated flow-durable-session.js to use shared MAX_SESSION_HISTORY constant
4. Marked _template skill as non-loadable (added loadable: false, template: true frontmatter)
5. Added checks in flow-skill-matcher.js to skip template/non-loadable skills
6. Fixed overlapping skill trigger keywords (removed generic ui/component/backend/api conflicts)
**Files**:
- scripts/flow-utils.js
- scripts/flow-durable-session.js
- scripts/flow-skill-matcher.js
- .claude/skills/_template/skill.md
- .claude/skills/figma-analyzer/skill.md
- .claude/skills/nestjs/skill.md
- .claude/skills/python/skill.md
- .claude/skills/react/skill.md

### R-029 | 2026-01-11 03:15
**Type**: fix
**Tags**: #security #high #wf-critical-high-v2 #code-review
**Request**: "Fix critical and high severity issues from second code review"
**Result**: Fixed 8 critical/high severity issues:
1. Fixed command injection in flow-suspend.js (validate poll commands before storing)
2. Created missing correction-report.md template in .workflow/templates/
3. Fixed race condition in flow-resume.js (use session.suspension instead of isSuspended())
4. Added createDurableSessionAsync with file locking to flow-durable-session.js
5. Updated flow-start.js to use async session creation with locking
6. Fixed ReDoS vulnerability in flow-damage-control.js (added safeRegExp validation)
7. Fixed command injection in flow-loop-enforcer.js (added sanitizeShellArg helper)
8. Standardized task ID format in documentation (TASK-XXX → wf-XXXXXXXX)
9. Removed non-existent command references from commands.md (metrics, insights, etc.)
**Files**:
- scripts/flow-suspend.js
- scripts/flow-resume.js
- scripts/flow-durable-session.js
- scripts/flow-start.js
- scripts/flow-damage-control.js
- scripts/flow-loop-enforcer.js
- .workflow/templates/correction-report.md
- CLAUDE.md
- templates/story.md
- templates/correction-report.md
- .claude/docs/commands.md

### R-030 | 2026-01-11 04:15
**Type**: fix
**Tags**: #bugfix #medium #wf-remaining-fixes #code-review
**Request**: "Fix remaining medium severity issues from code review"
**Result**: Fixed 4 remaining issues:
1. Updated CLAUDE.md state file list to include all files (components/, hybrid-session.json, export-map.json)
2. Added ready.json schema validation (validateReadyJson function in flow-utils.js)
3. Fixed race condition in setConfigValue (throw error instead of fallback to non-locked write)
4. Fixed race condition in flow-config-set.js (use withLock for concurrent-safe writes)
**Files**:
- CLAUDE.md
- scripts/flow-utils.js
- scripts/flow-config-set.js

### R-031 | 2026-01-11 06:15
**Type**: new
**Tags**: #feature:phase-0-foundation #wf-phase0-2 #failure-categories #refactor
**Request**: "Phase 0.2 - Failure Category Enum"
**Result**: Created centralized failure category system:
- Created `.workflow/lib/failure-categories.js` with:
  - FailureCategory enum (15 categories with code, description, severity, escalate, patterns, strategy)
  - Severity enum (low, medium, high, critical)
  - detectCategory() utility for error classification
  - getEscalationCategories() for cascade fallback support
  - getCategoryByCode(), getAllCodes(), shouldEscalate(), getSeverity() utilities
- Updated `flow-adaptive-learning.js` to use centralized categories:
  - ERROR_CATEGORIES now references FailureCategory
  - analyzeFailure() uses detectCategory() for consistent detection
  - Added new REFINEMENT_STRATEGIES (wait_retry, context_reduction, escalate, etc.)
  - Re-exports FailureCategory and detectCategory
- Updated `flow-loop-retry-learning.js` to use centralized categories:
  - ROOT_CAUSE_CATEGORIES uses spread from FailureCategory
  - Added new categories (IMPORT_ERROR, HALLUCINATION, CONTEXT_OVERFLOW, etc.)
  - Re-exports FailureCategory and detectCategory
**Files**:
- .workflow/lib/failure-categories.js (new)
- scripts/flow-adaptive-learning.js
- scripts/flow-loop-retry-learning.js

### R-032 | 2026-01-11 06:45
**Type**: new
**Tags**: #feature:phase-0-foundation #wf-phase0-3 #config #substitution
**Request**: "Phase 0.3 - Variable Substitution in Config"
**Result**: Added support for dynamic values in config files:
- Created `.workflow/lib/config-substitution.js` with:
  - substituteConfig() for processing config objects
  - substituteEnvVars() for `{env:VAR_NAME}` patterns
  - substituteFileContents() for `{file:path}` patterns
  - expandTilde() for `~` to home directory expansion
  - substituteDeep() for nested object/array processing
  - checkUnresolvedPatterns() for validation
  - getUsedPatterns() for pattern discovery
- Integrated with `flow-utils.js`:
  - getConfig() now applies substitution automatically
  - Added getRawConfig() for editing config without substitution
  - Warnings logged in DEBUG mode for unresolved patterns
- Features:
  - Environment variables: `{env:ANTHROPIC_API_KEY}` → actual value
  - File contents: `{file:~/.secrets/api-key}` → file contents (trimmed)
  - Tilde expansion: `~/.secrets` → `/Users/username/.secrets`
  - Graceful fallback: Missing vars keep placeholder
**Files**:
- .workflow/lib/config-substitution.js (new)
- scripts/flow-utils.js

### R-033 | 2026-01-11 07:30
**Type**: new
**Tags**: #feature:phase-0-foundation #wf-phase0-1-01 #models #registry
**Request**: "Create universal models directory structure"
**Result**: Created model registry foundation for multi-model support:
- Created `.workflow/models/` directory
- Created `registry.json` with comprehensive schema:
  - providers: anthropic, openai, google, ollama
  - models: claude-opus-4-5, claude-sonnet-4, claude-haiku-3-5, gpt-4o, gemini-2-flash
  - capabilities: code-gen, reasoning, analysis, structured-output, vision, extended-thinking
  - costTiers: economy, standard, premium with pricing
  - routing: default/byTaskType/byLanguage configuration
  - languages: Quality ratings (1-10) per model
- Created `stats.json` stub for performance tracking:
  - Summary metrics (tasks, tokens, cost)
  - Per-model, per-taskType, per-capability breakdowns
  - Failure stats and routing stats
  - Recent tasks array for history
**Files**:
- .workflow/models/registry.json (new)
- .workflow/models/stats.json (new)

### R-034 | 2026-01-11 08:30
**Type**: new
**Tags**: #feature:phase-0-foundation #wf-phase0-1-02 #installer #cli-agnosticism
**Request**: "Add CLI selection to installer"
**Result**: Added CLI type selection as first question in flow install:
- New `ask_cli_type()` function with 4 options:
  - Claude Code (default)
  - Gemini CLI
  - OpenCode
  - Other / Manual
- Added `CLI_TYPE` variable (defaults to "claude-code")
- Config.json now includes `cli` section:
  - `cli.type`: Selected CLI type
  - `cli.bridge.autoSync`: Auto-sync to CLI folder
  - `cli.bridge.syncOnConfigChange`: Sync on config changes
- Confirmation summary now shows CLI selection
- Question appears right after setup type selection
**Files**:
- scripts/flow-install

### R-035 | 2026-01-11 09:15
**Type**: new
**Tags**: #feature:phase-0-foundation #wf-phase0-1-03 #bridges #cli-agnosticism
**Request**: "Create CLI bridge architecture"
**Result**: Created CLI bridge system for generating CLI-specific files:
- Created `.workflow/bridges/` directory
- Created `base-bridge.js` - Abstract base class with:
  - Core sync methods: syncSkills(), syncRules(), generateRulesFile()
  - Utility methods: copyDirRecursive(), readConfig()
  - Abstract methods for subclasses: getCliFolder(), getRulesFileName(), etc.
- Created `index.js` - Bridge module entry point with:
  - getBridge() - Get bridge for current CLI type
  - syncBridge() - Run full sync
  - listAvailableBridges() - List implemented bridges
  - getCliType() - Read CLI type from config
- Added `flow bridge` command with subcommands:
  - `bridge sync` - Sync .workflow/ to CLI folder
  - `bridge status` - Show bridge configuration
  - `bridge list` - List available bridges
- Created `scripts/flow-bridge.js` - CLI handler
**Files**:
- .workflow/bridges/base-bridge.js (new)
- .workflow/bridges/index.js (new)
- scripts/flow-bridge.js (new)
- scripts/flow

### R-036 | 2026-01-11 10:00
**Type**: new
**Tags**: #feature:phase-0-foundation #wf-phase0-1-04 #bridges #claude-code
**Request**: "Implement Claude Code bridge"
**Result**: Created Claude Code bridge implementation:
- Created `claude-bridge.js` extending BaseBridge with:
  - Claude-specific folder paths (.claude, CLAUDE.md)
  - generateRulesContent() - Generates CLAUDE.md
  - generateDefaultClaudeMd() - Default comprehensive template
  - generateFromTemplate() - Custom Handlebars template support
  - setupCliSpecific() - Creates .claude/commands, docs, rules, skills
- Generated CLAUDE.md includes:
  - Task gating section (if strict mode enabled)
  - Quick start commands
  - Essential workflow commands table
  - Auto-validation section
  - Installed skills list
  - File locations table
  - Component reuse rules
  - Commit behavior guidelines
- Tested all bridge commands:
  - `flow bridge list` - Shows Claude as implemented
  - `flow bridge status` - Shows current configuration
  - `flow bridge sync` - Successfully syncs to .claude/
**Files**:
- .workflow/bridges/claude-bridge.js (new)