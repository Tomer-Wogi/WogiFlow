#!/usr/bin/env node
/**
 * Long Input Processing - CLI handler
 *
 * Extracted from flow-long-input.js to reduce file size.
 * Contains the main() CLI switch/case handler.
 */

const fs = require('node:fs');

// Colors for CLI output
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

// Local helper — 5 call sites referenced printWarn without defining it
// (latent no-undef bug caught by eslint upgrade; wf-5a6df88a).
function printWarn(msg) {
  console.warn(`${c.yellow}⚠ ${msg}${c.reset}`);
}

/**
 * CLI handler
 */
async function main() {
  // Lazy require to avoid circular dependency
  const longInput = require('./flow-long-input');
  const {
    // Core session
    getStatus, createSession, countWords, loadActiveDigest: _loadActiveDigest, saveActiveDigest: _saveActiveDigest,
    updatePhase: _updatePhase, saveTopics, loadTopics, loadStatementMap, loadOrphans,
    loadClarifications, saveClarifications: _saveClarifications,
    // Detection
    detectLargeInput, analyzeInput, classifyContentTypes, shouldExcludeContent,
    // Parsing - subtitles
    parseVTT, parseSRT, parseSubtitle, mergeCues, formatCuesAsText, getSubtitleStats,
    // Parsing - meetings
    parseZoom, parseTeams, parseMeeting, mergeMeetingEntries, formatMeetingAsText, getMeetingStats,
    // Language
    detectLanguage, detectMultipleLanguages, getLanguageInfo, LANGUAGE_INFO,
    listSupportedLanguages, setLanguagePreference, getSessionLanguageInfo, detectSessionLanguage,
    // Durable sessions
    loadDurableSessions, listDurableSessions, getDurableSession, switchDurableSession,
    archiveDurableSession, deleteDurableSession, generateRecoverySummaryForSession, getTimeSince,
    // Chunking
    needsChunking, planChunks, getChunkingStatus,
    // Passes
    runPass2, runPass3, runPass4,
    // Questions
    generateAllQuestions, processConversationResponse, getQuestionsForPresentation,
    formatQuestionsForUser, checkCompletion, resolveContradictionWithChoice,
    // Voice
    processVoiceAnswer,
    // Conversation
    captureAnswer, createDerivedStatement, checkFollowups, addFollowupQuestions,
    // Persistence
    detectInterruptedSession, resumeSession, reviewAnswers, getSessionHistory, exportSession,
    // Complexity
    analyzeComplexity,
    // Stories
    generateStoryFromTopic, generateAllStories, saveStory, loadStory, loadAllStories,
    formatStoryAsMarkdown,
    // Presentation
    getNextStory, getCurrentStory, approveCurrentStory, rejectCurrentStory, skipCurrentStory,
    formatStorySummary, formatActionsPrompt, getCompletionSummary, resetPresentation,
    getPresentationStatus,
    // Edit
    startEditSession, editUserStory, editCriterion, addCriterion, removeCriterion,
    getEditChanges, commitEditSession, cancelEditSession, getEditHistory, listEditableStories,
    // Export
    previewExport, exportApprovedStories, finalizeDigestion
  } = longInput;

  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'status':
      const status = getStatus();
      if (!status.active) {
        console.log(`${c.dim}No active digest session${c.reset}`);
      } else {
        console.log(`${c.green}Active digest:${c.reset} ${status.id}`);
        console.log(`${c.cyan}Current phase:${c.reset} ${status.phase}`);
        console.log(`${c.dim}Word count:${c.reset} ${status.input.word_count}`);
        console.log(`\n${c.cyan}Phase status:${c.reset}`);
        for (const [phase, data] of Object.entries(status.phases)) {
          const icon = data.status === 'completed' ? '✓' : data.status === 'in_progress' ? '→' : '○';
          console.log(`  ${icon} ${phase}: ${data.status}`);
        }
      }
      break;

    case 'new':
      // Read transcript from stdin or file
      const input = args[1];
      if (!input) {
        console.error(`${c.red}Usage: flow transcript-digest new <file or ->$}{c.reset}`);
        process.exit(1);
      }

      let transcript;
      if (input === '-') {
        // Read from stdin
        transcript = fs.readFileSync(0, 'utf8');
      } else {
        transcript = fs.readFileSync(input, 'utf8');
      }

      const { digestId, digestPath } = createSession(transcript);
      console.log(`${c.green}✓ Created digest session:${c.reset} ${digestId}`);
      console.log(`${c.dim}Path: ${digestPath}${c.reset}`);
      console.log(`${c.dim}Word count: ${countWords(transcript)}${c.reset}`);
      break;

    case 'check':
      // Check if text should trigger digestion (enhanced E4-S1)
      let textToCheck;
      if (!args[1] || args[1] === '-') {
        textToCheck = fs.readFileSync(0, 'utf8');
      } else {
        textToCheck = fs.readFileSync(args[1], 'utf8');
      }

      const checkResult = detectLargeInput(textToCheck);

      if (args.includes('--json')) {
        console.log(JSON.stringify(checkResult, null, 2));
        break;
      }

      // Human-readable output
      console.log(`${c.cyan}Input Analysis${c.reset}\n`);

      // Metrics
      console.log(`${c.dim}Metrics:${c.reset}`);
      console.log(`  Words: ${checkResult.metrics.wordCount.toLocaleString()}`);
      console.log(`  Characters: ${checkResult.metrics.charCount.toLocaleString()}`);
      console.log(`  Lines: ${checkResult.metrics.lineCount.toLocaleString()}`);
      console.log(`  Estimated tokens: ${checkResult.metrics.estimatedTokens.toLocaleString()}`);
      console.log();

      // Format
      const formatStr = checkResult.format.subtype ?
        `${checkResult.format.type} (${checkResult.format.subtype})` :
        checkResult.format.type;
      console.log(`${c.dim}Format:${c.reset} ${formatStr}`);
      console.log(`${c.dim}Format confidence:${c.reset} ${Math.round(checkResult.format.confidence * 100)}%`);
      console.log();

      // Thresholds
      console.log(`${c.dim}Thresholds:${c.reset}`);
      const wordExceeded = checkResult.thresholds.wordCount.exceeded ? `${c.green}✓` : `${c.yellow}✗`;
      const tokenExceeded = checkResult.thresholds.estimatedTokens.exceeded ? `${c.green}✓` : `${c.yellow}✗`;
      console.log(`  ${wordExceeded} Words: ${checkResult.thresholds.wordCount.value} / ${checkResult.thresholds.wordCount.threshold}${c.reset}`);
      console.log(`  ${tokenExceeded} Tokens: ${checkResult.thresholds.estimatedTokens.value} / ${checkResult.thresholds.estimatedTokens.threshold}${c.reset}`);
      console.log();

      // Recommendation
      console.log(`${c.cyan}Overall confidence:${c.reset} ${Math.round(checkResult.confidence * 100)}%`);
      const triggerIcon = checkResult.shouldTrigger === true ? `${c.green}✓` :
                          checkResult.shouldTrigger === 'ask' ? `${c.yellow}?` : `${c.red}✗`;
      console.log(`${c.cyan}Should trigger:${c.reset} ${triggerIcon} ${checkResult.recommendation.action}${c.reset}`);
      console.log(`${c.cyan}Reason:${c.reset} ${checkResult.reason}`);
      console.log();
      console.log(`${c.dim}${checkResult.recommendation.message}${c.reset}`);
      break;

    case 'analyze':
      // Detailed input analysis (E4-S1)
      let textToAnalyze;
      if (!args[1] || args[1] === '-') {
        textToAnalyze = fs.readFileSync(0, 'utf8');
      } else {
        textToAnalyze = fs.readFileSync(args[1], 'utf8');
      }

      const analysisResult = analyzeInput(textToAnalyze);

      if (args.includes('--json')) {
        console.log(JSON.stringify(analysisResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Detailed Input Analysis${c.reset}\n`);

      // Metrics table
      console.log(`${c.cyan}Metrics${c.reset}`);
      console.log(`┌────────────────────┬────────────────┐`);
      console.log(`│ Word count         │ ${String(analysisResult.metrics.wordCount.toLocaleString()).padStart(14)} │`);
      console.log(`│ Character count    │ ${String(analysisResult.metrics.charCount.toLocaleString()).padStart(14)} │`);
      console.log(`│ Line count         │ ${String(analysisResult.metrics.lineCount.toLocaleString()).padStart(14)} │`);
      console.log(`│ Paragraph count    │ ${String(analysisResult.metrics.paragraphCount.toLocaleString()).padStart(14)} │`);
      console.log(`│ Estimated tokens   │ ${String(analysisResult.metrics.estimatedTokens.toLocaleString()).padStart(14)} │`);
      console.log(`│ Avg words/line     │ ${String(analysisResult.metrics.avgWordsPerLine).padStart(14)} │`);
      console.log(`│ Avg chars/word     │ ${String(analysisResult.metrics.avgCharsPerWord).padStart(14)} │`);
      console.log(`└────────────────────┴────────────────┘`);
      console.log();

      // Format
      console.log(`${c.cyan}Format Detection${c.reset}`);
      console.log(`  Type: ${analysisResult.format.type}`);
      if (analysisResult.format.subtype) {
        console.log(`  Subtype: ${analysisResult.format.subtype}`);
      }
      console.log(`  Confidence: ${Math.round(analysisResult.format.confidence * 100)}%`);
      console.log();

      // Thresholds
      console.log(`${c.cyan}Threshold Analysis${c.reset}`);
      for (const [key, data] of Object.entries(analysisResult.thresholds)) {
        const icon = data.exceeded ? `${c.green}✓` : `${c.yellow}○`;
        console.log(`  ${icon} ${key}: ${data.value.toLocaleString()} / ${data.threshold.toLocaleString()}${c.reset}`);
      }
      console.log();

      console.log(`${c.cyan}Overall Confidence:${c.reset} ${Math.round(analysisResult.confidence * 100)}%`);
      break;

    case 'classify':
      // Classify content type (E4-S2)
      let textToClassify;
      if (!args[1] || args[1] === '-') {
        textToClassify = fs.readFileSync(0, 'utf8');
      } else {
        textToClassify = fs.readFileSync(args[1], 'utf8');
      }

      const classifyResult = classifyContentTypes(textToClassify);

      if (args.includes('--json')) {
        console.log(JSON.stringify(classifyResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Content Type Classification${c.reset}\n`);

      // Primary type
      const primaryColor = classifyResult.primary.type === 'unknown' ? c.yellow : c.green;
      console.log(`${c.cyan}Primary Type:${c.reset} ${primaryColor}${classifyResult.primary.type}${c.reset}`);
      console.log(`${c.dim}Confidence: ${Math.round(classifyResult.primary.confidence * 100)}%${c.reset}`);
      console.log();

      // Secondary types
      if (classifyResult.secondary.length > 0) {
        console.log(`${c.cyan}Secondary Types:${c.reset}`);
        for (const sec of classifyResult.secondary) {
          console.log(`  ${sec.type}: ${Math.round(sec.confidence * 100)}%`);
        }
        console.log();
      }

      // All scores
      if (args.includes('--verbose') || args.includes('-v')) {
        console.log(`${c.cyan}All Scores:${c.reset}`);
        const sortedScores = Object.entries(classifyResult.allScores)
          .sort((a, b) => b[1] - a[1]);
        for (const [type, score] of sortedScores) {
          const bar = '█'.repeat(Math.round(score * 20));
          const emptyBar = '░'.repeat(20 - Math.round(score * 20));
          console.log(`  ${type.padEnd(15)} ${bar}${emptyBar} ${Math.round(score * 100)}%`);
        }
        console.log();
      }

      // Evidence
      if (classifyResult.evidence.length > 0) {
        console.log(`${c.cyan}Evidence:${c.reset}`);
        for (const ev of classifyResult.evidence.slice(0, 5)) {
          console.log(`  ${ev.pattern}: ${ev.count} matches (weight: ${ev.weight})`);
          if (ev.samples.length > 0) {
            console.log(`    ${c.dim}e.g., "${ev.samples[0]}"${c.reset}`);
          }
        }
        console.log();
      }

      // Recommendation
      console.log(`${c.cyan}Recommendation:${c.reset}`);
      console.log(`  Action: ${classifyResult.recommendation.action}`);
      console.log(`  ${c.dim}${classifyResult.recommendation.description}${c.reset}`);
      break;

    case 'recommend':
      // Get processing recommendation (E4-S2)
      let textToRecommend;
      if (!args[1] || args[1] === '-') {
        textToRecommend = fs.readFileSync(0, 'utf8');
      } else {
        textToRecommend = fs.readFileSync(args[1], 'utf8');
      }

      const recommendResult = classifyContentTypes(textToRecommend);
      const exclusion = shouldExcludeContent(recommendResult);

      if (args.includes('--json')) {
        console.log(JSON.stringify({
          classification: recommendResult,
          exclusion
        }, null, 2));
        break;
      }

      console.log(`${c.cyan}Processing Recommendation${c.reset}\n`);

      // Content type
      console.log(`${c.dim}Content type:${c.reset} ${recommendResult.primary.type} (${Math.round(recommendResult.primary.confidence * 100)}%)`);
      console.log();

      // Recommendation
      if (exclusion.exclude) {
        console.log(`${c.red}✗ Not recommended for digestion${c.reset}`);
        console.log(`  ${c.dim}${exclusion.reason}${c.reset}`);
      } else {
        console.log(`${c.green}✓ Recommended for digestion${c.reset}`);
        console.log(`  ${c.cyan}Action:${c.reset} ${recommendResult.recommendation.action}`);
        console.log(`  ${c.dim}${recommendResult.recommendation.description}${c.reset}`);
      }
      break;

    case 'parse-vtt':
      // Parse VTT subtitle file (E4-S3)
      {
        let vttContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          vttContent = fs.readFileSync(0, 'utf8');
        } else {
          vttContent = fs.readFileSync(args[1], 'utf8');
        }

        const vttResult = parseVTT(vttContent);

        if (args.includes('--json')) {
          console.log(JSON.stringify(vttResult, null, 2));
          break;
        }

        // Output format options
        const withTimestamps = args.includes('--timestamps') || args.includes('-t');
        const withSpeakers = args.includes('--speakers') || args.includes('-s');
        const noMerge = args.includes('--no-merge');

        const cues = noMerge ? vttResult.cues : mergeCues(vttResult.cues);
        const text = formatCuesAsText(cues, { timestamps: withTimestamps, speakers: withSpeakers });

        if (args.includes('--stats')) {
          const statsResult = { cues, format: vttResult.format };
          const stats = getSubtitleStats(statsResult);
          const avgCueDurationMs = stats.cueCount > 0 ? stats.totalDurationMs / stats.cueCount : 0;
          console.log(`${c.cyan}VTT Statistics${c.reset}\n`);
          console.log(`Cues: ${stats.cueCount}`);
          console.log(`Duration: ${stats.totalDuration}`);
          console.log(`Speakers: ${stats.speakerCount > 0 ? stats.speakers.join(', ') : 'None detected'}`);
          console.log(`Avg cue duration: ${(avgCueDurationMs / 1000).toFixed(1)}s`);
          console.log(`\n${c.dim}--- Parsed Text ---${c.reset}\n`);
        }

        console.log(text);
      }
      break;

    case 'parse-srt':
      // Parse SRT subtitle file (E4-S3)
      {
        let srtContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          srtContent = fs.readFileSync(0, 'utf8');
        } else {
          srtContent = fs.readFileSync(args[1], 'utf8');
        }

        const srtResult = parseSRT(srtContent);

        if (args.includes('--json')) {
          console.log(JSON.stringify(srtResult, null, 2));
          break;
        }

        // Output format options
        const withTimestamps = args.includes('--timestamps') || args.includes('-t');
        const withSpeakers = args.includes('--speakers') || args.includes('-s');
        const noMerge = args.includes('--no-merge');

        const cues = noMerge ? srtResult.cues : mergeCues(srtResult.cues);
        const text = formatCuesAsText(cues, { timestamps: withTimestamps, speakers: withSpeakers });

        if (args.includes('--stats')) {
          const statsResult = { cues, format: srtResult.format };
          const stats = getSubtitleStats(statsResult);
          const avgCueDurationMs = stats.cueCount > 0 ? stats.totalDurationMs / stats.cueCount : 0;
          console.log(`${c.cyan}SRT Statistics${c.reset}\n`);
          console.log(`Cues: ${stats.cueCount}`);
          console.log(`Duration: ${stats.totalDuration}`);
          console.log(`Speakers: ${stats.speakerCount > 0 ? stats.speakers.join(', ') : 'None detected'}`);
          console.log(`Avg cue duration: ${(avgCueDurationMs / 1000).toFixed(1)}s`);
          console.log(`\n${c.dim}--- Parsed Text ---${c.reset}\n`);
        }

        console.log(text);
      }
      break;

    case 'parse-subtitle':
      // Auto-detect and parse subtitle file (E4-S3)
      {
        let subtitleContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          subtitleContent = fs.readFileSync(0, 'utf8');
        } else {
          subtitleContent = fs.readFileSync(args[1], 'utf8');
        }

        const subtitleResult = parseSubtitle(subtitleContent);

        if (subtitleResult.error) {
          if (args.includes('--json')) {
            console.log(JSON.stringify(subtitleResult, null, 2));
          } else {
            console.error(`${c.red}Error: ${subtitleResult.error}${c.reset}`);
            console.error(`${c.dim}Tip: Ensure the file has enough content for format detection${c.reset}`);
          }
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(subtitleResult, null, 2));
          break;
        }

        // Output format options
        const withTimestamps = args.includes('--timestamps') || args.includes('-t');
        const withSpeakers = args.includes('--speakers') || args.includes('-s');
        const noMerge = args.includes('--no-merge');

        const cues = noMerge ? subtitleResult.cues : mergeCues(subtitleResult.cues);
        const text = formatCuesAsText(cues, { timestamps: withTimestamps, speakers: withSpeakers });

        if (args.includes('--stats')) {
          const statsResult = { cues, format: subtitleResult.format };
          const stats = getSubtitleStats(statsResult);
          const avgCueDurationMs = stats.cueCount > 0 ? stats.totalDurationMs / stats.cueCount : 0;
          console.log(`${c.cyan}${subtitleResult.format.toUpperCase()} Statistics${c.reset}\n`);
          console.log(`Format: ${subtitleResult.format}`);
          console.log(`Cues: ${stats.cueCount}`);
          console.log(`Duration: ${stats.totalDuration}`);
          console.log(`Speakers: ${stats.speakerCount > 0 ? stats.speakers.join(', ') : 'None detected'}`);
          console.log(`Avg cue duration: ${(avgCueDurationMs / 1000).toFixed(1)}s`);
          console.log(`\n${c.dim}--- Parsed Text ---${c.reset}\n`);
        }

        console.log(text);
      }
      break;

    case 'parse-zoom':
      // Parse Zoom transcript (E4-S4)
      {
        let zoomContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          zoomContent = fs.readFileSync(0, 'utf8');
        } else {
          zoomContent = fs.readFileSync(args[1], 'utf8');
        }

        const zoomOptions = {
          includeSystem: args.includes('--include-system'),
          format: args.includes('--format') ? args[args.indexOf('--format') + 1] : null
        };
        const zoomResult = parseZoom(zoomContent, zoomOptions);

        if (zoomResult.error) {
          if (args.includes('--json')) {
            console.log(JSON.stringify(zoomResult, null, 2));
          } else {
            console.error(`${c.red}Error: ${zoomResult.error}${c.reset}`);
          }
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(zoomResult, null, 2));
          break;
        }

        const zoomWithTimestamps = args.includes('--timestamps') || args.includes('-t');
        const zoomNoMerge = args.includes('--no-merge');
        const zoomEntries = zoomNoMerge ? zoomResult.entries : mergeMeetingEntries(zoomResult.entries);
        const zoomText = formatMeetingAsText(zoomEntries, { timestamps: zoomWithTimestamps });

        if (args.includes('--stats')) {
          const stats = getMeetingStats({ ...zoomResult, entries: zoomEntries });
          console.log(`${c.cyan}Zoom Transcript Statistics${c.reset}\n`);
          console.log(`Format: ${stats.format}`);
          console.log(`Entries: ${stats.entryCount}`);
          console.log(`Participants: ${stats.participants.join(', ') || 'None detected'}`);
          console.log(`Total words: ${stats.totalWords}`);
          if (Object.keys(stats.speakerCounts).length > 0) {
            console.log(`\n${c.dim}Messages per speaker:${c.reset}`);
            for (const [speaker, count] of Object.entries(stats.speakerCounts)) {
              console.log(`  ${speaker}: ${count}`);
            }
          }
          console.log(`\n${c.dim}--- Transcript ---${c.reset}\n`);
        }

        console.log(zoomText);
      }
      break;

    case 'parse-teams':
      // Parse Teams transcript (E4-S4)
      {
        let teamsContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          teamsContent = fs.readFileSync(0, 'utf8');
        } else {
          teamsContent = fs.readFileSync(args[1], 'utf8');
        }

        const teamsOptions = {
          includeSystem: args.includes('--include-system'),
          format: args.includes('--format') ? args[args.indexOf('--format') + 1] : null
        };
        const teamsResult = parseTeams(teamsContent, teamsOptions);

        if (teamsResult.error) {
          if (args.includes('--json')) {
            console.log(JSON.stringify(teamsResult, null, 2));
          } else {
            console.error(`${c.red}Error: ${teamsResult.error}${c.reset}`);
          }
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(teamsResult, null, 2));
          break;
        }

        const teamsWithTimestamps = args.includes('--timestamps') || args.includes('-t');
        const teamsNoMerge = args.includes('--no-merge');
        const teamsEntries = teamsNoMerge ? teamsResult.entries : mergeMeetingEntries(teamsResult.entries);
        const teamsText = formatMeetingAsText(teamsEntries, { timestamps: teamsWithTimestamps });

        if (args.includes('--stats')) {
          const stats = getMeetingStats({ ...teamsResult, entries: teamsEntries });
          console.log(`${c.cyan}Teams Transcript Statistics${c.reset}\n`);
          console.log(`Format: ${stats.format}`);
          console.log(`Entries: ${stats.entryCount}`);
          console.log(`Participants: ${stats.participants.join(', ') || 'None detected'}`);
          console.log(`Total words: ${stats.totalWords}`);
          if (Object.keys(stats.speakerCounts).length > 0) {
            console.log(`\n${c.dim}Messages per speaker:${c.reset}`);
            for (const [speaker, count] of Object.entries(stats.speakerCounts)) {
              console.log(`  ${speaker}: ${count}`);
            }
          }
          console.log(`\n${c.dim}--- Transcript ---${c.reset}\n`);
        }

        console.log(teamsText);
      }
      break;

    case 'parse-meeting':
      // Auto-detect and parse meeting transcript (E4-S4)
      {
        let meetingContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          meetingContent = fs.readFileSync(0, 'utf8');
        } else {
          meetingContent = fs.readFileSync(args[1], 'utf8');
        }

        const meetingOptions = {
          includeSystem: args.includes('--include-system')
        };
        const meetingResult = parseMeeting(meetingContent, meetingOptions);

        if (meetingResult.error) {
          if (args.includes('--json')) {
            console.log(JSON.stringify(meetingResult, null, 2));
          } else {
            console.error(`${c.red}Error: ${meetingResult.error}${c.reset}`);
            console.error(`${c.dim}Tip: Ensure the file is a valid Zoom or Teams export${c.reset}`);
          }
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(meetingResult, null, 2));
          break;
        }

        const meetingWithTimestamps = args.includes('--timestamps') || args.includes('-t');
        const meetingNoMerge = args.includes('--no-merge');
        const meetingEntries = meetingNoMerge ? meetingResult.entries : mergeMeetingEntries(meetingResult.entries);
        const meetingText = formatMeetingAsText(meetingEntries, { timestamps: meetingWithTimestamps });

        if (args.includes('--stats')) {
          const stats = getMeetingStats({ ...meetingResult, entries: meetingEntries });
          console.log(`${c.cyan}Meeting Transcript Statistics${c.reset}\n`);
          console.log(`Format: ${stats.format}`);
          console.log(`Entries: ${stats.entryCount}`);
          console.log(`Participants: ${stats.participants.join(', ') || 'None detected'}`);
          console.log(`Total words: ${stats.totalWords}`);
          if (Object.keys(stats.speakerCounts).length > 0) {
            console.log(`\n${c.dim}Messages per speaker:${c.reset}`);
            for (const [speaker, count] of Object.entries(stats.speakerCounts)) {
              console.log(`  ${speaker}: ${count}`);
            }
          }
          console.log(`\n${c.dim}--- Transcript ---${c.reset}\n`);
        }

        console.log(meetingText);
      }
      break;

    case 'detect-language':
      // Detect primary language (E5-S1)
      {
        let langContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          langContent = fs.readFileSync(0, 'utf8');
        } else {
          langContent = fs.readFileSync(args[1], 'utf8');
        }

        const langResult = detectLanguage(langContent);

        if (args.includes('--json')) {
          console.log(JSON.stringify(langResult, null, 2));
          break;
        }

        console.log(`${c.cyan}Language Detection${c.reset}\n`);
        const langColor = langResult.language === 'unknown' ? c.yellow : c.green;
        console.log(`${c.dim}Primary:${c.reset} ${langColor}${langResult.languageName}${c.reset} (${langResult.language})`);
        console.log(`${c.dim}Confidence:${c.reset} ${Math.round(langResult.confidence * 100)}%`);

        if (langResult.secondary) {
          console.log(`\n${c.dim}Secondary:${c.reset} ${langResult.secondary.languageName} (${langResult.secondary.language})`);
          console.log(`${c.dim}Confidence:${c.reset} ${Math.round(langResult.secondary.confidence * 100)}%`);
        }

        if (args.includes('-v') || args.includes('--verbose')) {
          if (Object.keys(langResult.scripts || {}).length > 0) {
            console.log(`\n${c.dim}Scripts detected:${c.reset}`);
            for (const [script, count] of Object.entries(langResult.scripts)) {
              console.log(`  ${script}: ${count} chars`);
            }
          }
          if (Object.keys(langResult.wordMatches || {}).length > 0) {
            console.log(`\n${c.dim}Word matches:${c.reset}`);
            for (const [lang, count] of Object.entries(langResult.wordMatches)) {
              const name = LANGUAGE_INFO[lang]?.name || lang;
              console.log(`  ${name}: ${count}`);
            }
          }
        }
      }
      break;

    case 'detect-languages':
      // Detect multiple languages (E5-S1)
      {
        let multiLangContent;
        if (!args[1] || args[1] === '-' || args[1].startsWith('--')) {
          multiLangContent = fs.readFileSync(0, 'utf8');
        } else {
          multiLangContent = fs.readFileSync(args[1], 'utf8');
        }

        const segmentSizeArg = args.indexOf('--segment-size');
        const segmentSize = segmentSizeArg > -1 ? parseInt(args[segmentSizeArg + 1], 10) : 300;

        const multiResult = detectMultipleLanguages(multiLangContent, { segmentSize });

        if (args.includes('--json')) {
          console.log(JSON.stringify(multiResult, null, 2));
          break;
        }

        console.log(`${c.cyan}Multi-language Detection${c.reset}\n`);
        console.log(`${c.dim}Primary:${c.reset} ${multiResult.languageName} (${multiResult.language})`);
        console.log(`${c.dim}Multilingual:${c.reset} ${multiResult.isMultilingual ? c.yellow + 'Yes' + c.reset : 'No'}`);
        console.log(`${c.dim}Segments analyzed:${c.reset} ${multiResult.segmentCount}`);

        if (Object.keys(multiResult.distribution || {}).length > 0) {
          console.log(`\n${c.dim}Language distribution:${c.reset}`);
          for (const [lang, pct] of Object.entries(multiResult.distribution).sort((a, b) => b[1] - a[1])) {
            const name = LANGUAGE_INFO[lang]?.name || lang;
            console.log(`  ${name}: ${Math.round(pct * 100)}%`);
          }
        }
      }
      break;

    case 'language-info':
      // Get language info (E5-S1)
      {
        const langCode = args[1] && !args[1].startsWith('--') ? args[1] : null;
        if (!langCode) {
          // List all supported languages
          const langs = listSupportedLanguages();

          if (args.includes('--json')) {
            console.log(JSON.stringify(langs, null, 2));
            break;
          }

          console.log(`${c.cyan}Supported Languages${c.reset}\n`);
          console.log(`${c.dim}Tier 1 (Full support):${c.reset}`);
          for (const lang of langs.filter(l => l.tier === 1)) {
            console.log(`  ${lang.code}: ${lang.name} (${lang.script}${lang.rtl ? ', RTL' : ''})`);
          }
          console.log(`\n${c.dim}Tier 2 (Good support):${c.reset}`);
          for (const lang of langs.filter(l => l.tier === 2)) {
            console.log(`  ${lang.code}: ${lang.name} (${lang.script}${lang.rtl ? ', RTL' : ''})`);
          }
          console.log(`\n${c.dim}Tier 3 (Basic support):${c.reset}`);
          for (const lang of langs.filter(l => l.tier === 3)) {
            console.log(`  ${lang.code}: ${lang.name} (${lang.script}${lang.rtl ? ', RTL' : ''})`);
          }
          break;
        }

        const info = getLanguageInfo(langCode);

        if (args.includes('--json')) {
          console.log(JSON.stringify(info, null, 2));
          break;
        }

        if (!info.supported) {
          console.error(`${c.yellow}Language code '${langCode}' not found${c.reset}`);
          console.log(`${c.dim}Use 'language-info' without arguments to list all supported languages${c.reset}`);
          break;
        }

        console.log(`${c.cyan}Language: ${info.name}${c.reset}\n`);
        console.log(`Code: ${info.code}`);
        console.log(`Script: ${info.script}`);
        console.log(`RTL: ${info.rtl ? 'Yes' : 'No'}`);
        console.log(`Common words: ${info.hasCommonWords ? 'Yes' : 'No'}`);
        console.log(`Trigram profile: ${info.hasTrigrams ? 'Yes' : 'No'}`);
      }
      break;

    case 'set-language':
      // Set preferred language for questions (E5-S2)
      {
        const langCode = args[1];
        if (!langCode || langCode.startsWith('--')) {
          console.error(`${c.red}Usage: set-language <language-code>${c.reset}`);
          console.log(`${c.dim}Example: set-language es${c.reset}`);
          console.log(`${c.dim}Use 'language-info' to see supported languages${c.reset}`);
          process.exit(1);
        }

        try {
          const result = setLanguagePreference(langCode);

          if (args.includes('--json')) {
            console.log(JSON.stringify(result, null, 2));
            break;
          }

          console.log(`${c.green}✓ Language preference set${c.reset}`);
          console.log(`${c.dim}Language:${c.reset} ${result.languageName} (${result.language})`);
          console.log(`${c.dim}Questions will now be generated in ${result.languageName}${c.reset}`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'show-language':
      // Show current language settings (E5-S2)
      {
        try {
          const langInfo = getSessionLanguageInfo();

          if (args.includes('--json')) {
            console.log(JSON.stringify(langInfo, null, 2));
            break;
          }

          console.log(`${c.cyan}Session Language Settings${c.reset}\n`);

          if (langInfo.detected) {
            console.log(`${c.dim}Detected:${c.reset} ${langInfo.detectedName} (${langInfo.detected})`);
            console.log(`${c.dim}Confidence:${c.reset} ${Math.round(langInfo.confidence * 100)}%`);
          } else {
            console.log(`${c.dim}Detected:${c.reset} Not detected yet`);
          }

          if (langInfo.preferred) {
            console.log(`${c.dim}Preferred:${c.reset} ${langInfo.preferredName} (${langInfo.preferred})`);
          } else {
            console.log(`${c.dim}Preferred:${c.reset} Not set`);
          }

          console.log(`${c.dim}Multilingual:${c.reset} ${langInfo.isMultilingual ? 'Yes' : 'No'}`);

          if (langInfo.isMultilingual && Object.keys(langInfo.distribution).length > 0) {
            console.log(`\n${c.dim}Language distribution:${c.reset}`);
            for (const [lang, pct] of Object.entries(langInfo.distribution)) {
              const name = LANGUAGE_INFO[lang]?.name || lang;
              console.log(`  ${name}: ${Math.round(pct * 100)}%`);
            }
          }

          console.log(`\n${c.dim}Effective (for questions):${c.reset} ${LANGUAGE_INFO[langInfo.effective]?.name || langInfo.effective}`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'detect-session-language':
      // Detect and store session language (E5-S2)
      {
        try {
          const result = detectSessionLanguage();

          if (args.includes('--json')) {
            console.log(JSON.stringify(result, null, 2));
            break;
          }

          if (!result.detected) {
            console.log(`${c.yellow}Could not detect language: ${result.reason}${c.reset}`);
            break;
          }

          console.log(`${c.green}✓ Language detected${c.reset}`);
          console.log(`${c.dim}Language:${c.reset} ${result.languageName} (${result.language})`);
          console.log(`${c.dim}Confidence:${c.reset} ${Math.round(result.confidence * 100)}%`);
          console.log(`${c.dim}Multilingual:${c.reset} ${result.isMultilingual ? 'Yes' : 'No'}`);

          if (result.isMultilingual && result.distribution) {
            console.log(`\n${c.dim}Language distribution:${c.reset}`);
            for (const [lang, pct] of Object.entries(result.distribution)) {
              const name = LANGUAGE_INFO[lang]?.name || lang;
              console.log(`  ${name}: ${Math.round(pct * 100)}%`);
            }
          }
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'sessions':
      // List all durable digest sessions (E5-S3)
      {
        const statusFilter = args.find(a => a.startsWith('--status='))?.split('=')[1] ||
                            (args.includes('--active') ? 'active' : null);
        const result = listDurableSessions({ status: statusFilter });

        if (args.includes('--json')) {
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        console.log(`${c.cyan}Digest Sessions${c.reset}\n`);

        if (result.sessions.length === 0) {
          console.log(`${c.dim}No sessions found${c.reset}`);
          break;
        }

        for (const session of result.sessions) {
          const isActive = session.id === result.active_id;
          const marker = isActive ? `${c.green}*${c.reset}` : ' ';
          const statusColor = session.status === 'completed' ? c.green :
                             session.status === 'active' ? c.cyan :
                             session.status === 'archived' ? c.dim : c.yellow;

          console.log(`${marker} ${c.bold}${session.id}${c.reset}`);
          console.log(`    Name: ${session.name}`);
          console.log(`    Status: ${statusColor}${session.status}${c.reset}`);
          console.log(`    Progress: ${session.progress?.phase || 'unknown'}`);
          console.log(`    Updated: ${getTimeSince(session.updated_at)}`);
          console.log('');
        }

        console.log(`${c.dim}Total: ${result.total} sessions${c.reset}`);
        if (result.active_id) {
          console.log(`${c.dim}Active: ${result.active_id}${c.reset}`);
        }
      }
      break;

    case 'session-info':
      // Show details for a specific session (E5-S3)
      {
        const sessionId = args[1];
        if (!sessionId || sessionId.startsWith('--')) {
          console.error(`${c.red}Usage: session-info <session-id>${c.reset}`);
          process.exit(1);
        }

        const session = getDurableSession(sessionId);
        if (!session) {
          console.error(`${c.red}Session not found: ${sessionId}${c.reset}`);
          process.exit(1);
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(session, null, 2));
          break;
        }

        const summary = generateRecoverySummaryForSession(sessionId);

        console.log(`${c.cyan}Session: ${session.name}${c.reset}`);
        console.log(`ID: ${session.id}`);
        console.log(`Status: ${session.status}${session.is_active ? ' (active)' : ''}`);
        console.log(`Last active: ${summary.last_active}`);
        console.log('');
        console.log(`${c.dim}Progress:${c.reset}`);
        console.log(`  Phase: ${summary.progress.phase}`);
        console.log(`  Topics: ${summary.progress.topics}`);
        console.log(`  Statements: ${summary.progress.statements}`);
        console.log(`  Questions: ${summary.progress.questions.answered}/${summary.progress.questions.total}`);
        console.log(`  Stories: ${summary.progress.stories.approved}/${summary.progress.stories.generated} approved`);
        console.log('');
        console.log(`${c.dim}Next action:${c.reset} ${summary.next_action.action}`);
        console.log(`${c.dim}Command:${c.reset} flow transcript-digest ${summary.next_action.command}`);
        console.log('');
        console.log(`${c.dim}Checkpoints:${c.reset} ${summary.checkpoints_count}`);
      }
      break;

    case 'switch-session':
      // Switch to a different session (E5-S3)
      {
        const sessionId = args[1];
        if (!sessionId || sessionId.startsWith('--')) {
          console.error(`${c.red}Usage: switch-session <session-id>${c.reset}`);
          process.exit(1);
        }

        try {
          const session = switchDurableSession(sessionId);
          const summary = generateRecoverySummaryForSession(sessionId);

          console.log(`${c.green}✓ Switched to session${c.reset}`);
          console.log(`${c.dim}Session:${c.reset} ${session.name} (${session.id})`);
          console.log(`${c.dim}Phase:${c.reset} ${summary.progress.phase}`);
          console.log('');
          console.log(`${c.dim}Next action:${c.reset} ${summary.next_action.action}`);
          console.log(`${c.dim}Run:${c.reset} flow transcript-digest ${summary.next_action.command}`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'archive-session':
      // Archive a session (E5-S3)
      {
        const sessionId = args[1];
        if (!sessionId || sessionId.startsWith('--')) {
          console.error(`${c.red}Usage: archive-session <session-id>${c.reset}`);
          process.exit(1);
        }

        try {
          const session = archiveDurableSession(sessionId);
          console.log(`${c.green}✓ Session archived${c.reset}`);
          console.log(`${c.dim}Session:${c.reset} ${session.name} (${session.id})`);
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'delete-session':
      // Delete a session (E5-S3)
      {
        const sessionId = args[1];
        if (!sessionId || sessionId.startsWith('--')) {
          console.error(`${c.red}Usage: delete-session <session-id> [--delete-files]${c.reset}`);
          process.exit(1);
        }

        const deleteFiles = args.includes('--delete-files');

        try {
          deleteDurableSession(sessionId, deleteFiles);
          console.log(`${c.green}✓ Session deleted${c.reset}`);
          if (deleteFiles) {
            console.log(`${c.dim}Files also deleted${c.reset}`);
          }
        } catch (err) {
          console.error(`${c.red}Error: ${err.message}${c.reset}`);
          process.exit(1);
        }
      }
      break;

    case 'session-recovery':
      // Show recovery summary for current or specified session (E5-S3)
      {
        const durable = loadDurableSessions();
        const sessionId = args[1] && !args[1].startsWith('--') ? args[1] : durable.active_session_id;

        if (!sessionId) {
          console.error(`${c.red}No active session. Specify a session ID or create a new session.${c.reset}`);
          process.exit(1);
        }

        const summary = generateRecoverySummaryForSession(sessionId);

        if (summary.error) {
          console.error(`${c.red}Error: ${summary.error}${c.reset}`);
          process.exit(1);
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(summary, null, 2));
          break;
        }

        console.log(`${c.cyan}Recovery Summary${c.reset}\n`);
        console.log(`Session: ${summary.name} (${summary.session_id})`);
        console.log(`Status: ${summary.status}`);
        console.log(`Last active: ${summary.last_active}`);
        console.log('');
        console.log(`${c.dim}Progress:${c.reset}`);
        console.log(`  - Topics: ${summary.progress.topics} extracted`);
        console.log(`  - Statements: ${summary.progress.statements} associated`);
        console.log(`  - Questions: ${summary.progress.questions.answered}/${summary.progress.questions.total} answered`);
        if (summary.progress.questions.pending > 0) {
          console.log(`    ${c.yellow}(${summary.progress.questions.pending} pending)${c.reset}`);
        }
        console.log(`  - Stories: ${summary.progress.stories.approved}/${summary.progress.stories.generated} approved`);
        console.log('');
        console.log(`${c.green}To continue:${c.reset} Run '${summary.next_action.command}'`);
      }
      break;

    // ===== E5-S4: Large Transcript Chunking Commands =====

    case 'needs-chunking':
      // Check if input needs chunking (E5-S4)
      {
        let inputText = '';
        const inputFile = args[1];

        if (inputFile && inputFile !== '-' && !inputFile.startsWith('--')) {
          // Read from file
          if (!fs.existsSync(inputFile)) {
            console.error(`${c.red}File not found: ${inputFile}${c.reset}`);
            process.exit(1);
          }
          inputText = fs.readFileSync(inputFile, 'utf8');
        } else if (inputFile === '-' || !inputFile) {
          // Read from stdin
          inputText = fs.readFileSync(0, 'utf8');
        }

        const result = needsChunking(inputText);

        if (args.includes('--json')) {
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        console.log(`${c.cyan}Chunking Analysis${c.reset}\n`);
        console.log(`${c.dim}Needs chunking:${c.reset} ${result.needed ? `${c.yellow}Yes${c.reset}` : `${c.green}No${c.reset}`}`);
        console.log(`${c.dim}Word count:${c.reset} ${result.metrics.words.toLocaleString()} ${result.metrics.words > result.metrics.thresholds.words ? `${c.yellow}(exceeds ${result.metrics.thresholds.words.toLocaleString()})${c.reset}` : ''}`);
        console.log(`${c.dim}Token estimate:${c.reset} ${result.metrics.tokens.toLocaleString()} ${result.metrics.tokens > result.metrics.thresholds.tokens ? `${c.yellow}(exceeds ${result.metrics.thresholds.tokens.toLocaleString()})${c.reset}` : ''}`);
        console.log(`${c.dim}Character count:${c.reset} ${result.metrics.chars.toLocaleString()}`);

        if (result.reason) {
          console.log('');
          console.log(`${c.dim}Triggered by:${c.reset} ${result.reason}`);
        }
      }
      break;

    case 'plan-chunks':
      // Plan how to chunk a transcript (E5-S4)
      {
        let inputText = '';
        const inputFile = args[1];

        if (inputFile && inputFile !== '-' && !inputFile.startsWith('--')) {
          if (!fs.existsSync(inputFile)) {
            console.error(`${c.red}File not found: ${inputFile}${c.reset}`);
            process.exit(1);
          }
          inputText = fs.readFileSync(inputFile, 'utf8');
        } else if (inputFile === '-' || !inputFile) {
          inputText = fs.readFileSync(0, 'utf8');
        }

        // Parse options
        const options = {};
        const targetWordsIdx = args.indexOf('--target-words');
        if (targetWordsIdx !== -1 && args[targetWordsIdx + 1]) {
          options.targetChunkWords = parseInt(args[targetWordsIdx + 1], 10);
        }

        const plan = planChunks(inputText, options);

        if (args.includes('--json')) {
          console.log(JSON.stringify(plan, null, 2));
          break;
        }

        console.log(`${c.cyan}Chunk Plan${c.reset}\n`);
        console.log(`${c.dim}Total words:${c.reset} ${plan.total_words.toLocaleString()}`);
        console.log(`${c.dim}Chunks planned:${c.reset} ${plan.total_chunks}`);
        console.log(`${c.dim}Avg words/chunk:${c.reset} ${plan.avg_chunk_words.toLocaleString()}`);
        console.log('');

        plan.chunks.forEach((chunk, i) => {
          const boundaryInfo = chunk.boundary_type ? ` [${chunk.boundary_type}]` : '';
          console.log(`${c.dim}Chunk ${i + 1}:${c.reset} ${chunk.word_count.toLocaleString()} words, chars ${chunk.start_offset}-${chunk.end_offset}${boundaryInfo}`);
        });
      }
      break;

    case 'chunk-status':
      // Show current chunking status (E5-S4)
      {
        const status = getChunkingStatus();

        if (!status || !status.enabled) {
          console.log(`${c.dim}No active chunking session${c.reset}`);
          break;
        }

        if (args.includes('--json')) {
          console.log(JSON.stringify(status, null, 2));
          break;
        }

        console.log(`${c.cyan}Chunking Status${c.reset}\n`);
        console.log(`${c.dim}Total chunks:${c.reset} ${status.total_chunks}`);
        console.log(`${c.dim}Completed:${c.reset} ${status.completed}/${status.total_chunks}`);
        console.log(`${c.dim}Progress:${c.reset} ${status.progress}%`);
        console.log('');

        if (status.chunks && status.chunks.length > 0) {
          console.log(`${c.dim}Chunk Details:${c.reset}`);
          status.chunks.forEach(chunk => {
            const statusIcon = chunk.status === 'completed' ? `${c.green}✓${c.reset}` :
                              chunk.status === 'in_progress' ? `${c.yellow}→${c.reset}` :
                              chunk.status === 'failed' ? `${c.red}✗${c.reset}` :
                              `${c.dim}○${c.reset}`;
            const topicsInfo = chunk.topics !== null ? ` (${chunk.topics} topics, ${chunk.statements} stmts)` : '';
            console.log(`  ${statusIcon} ${chunk.id}: ${chunk.status}${topicsInfo}`);
          });
        }

        if (status.merge_status) {
          console.log('');
          console.log(`${c.dim}Merge status:${c.reset} ${status.merge_status}`);
        }
      }
      break;

    case 'topics':
      const topics = loadTopics();
      if (!topics) {
        console.error(`${c.red}No active digest or topics not yet extracted${c.reset}`);
        process.exit(1);
      }
      console.log(JSON.stringify(topics, null, 2));
      break;

    case 'save-topics':
      // Save topics from stdin (JSON)
      const topicsJson = fs.readFileSync(0, 'utf8');
      const parsedTopics = JSON.parse(topicsJson);
      const saved = saveTopics(parsedTopics);
      console.log(`${c.green}✓ Saved ${saved.topics.length} topics${c.reset}`);
      break;

    case 'pass2':
    case 'statements':
      // Run Pass 2: Statement Association
      try {
        const pass2Result = runPass2();
        console.log(`${c.green}✓ Pass 2 complete${c.reset}`);
        console.log(`${c.cyan}Statements:${c.reset} ${pass2Result.metadata.total_statements} total`);
        console.log(`  ${c.dim}Meaningful:${c.reset} ${pass2Result.metadata.meaningful_statements}`);
        console.log(`  ${c.dim}Mapped:${c.reset} ${pass2Result.metadata.mapped_statements}`);
        console.log(`  ${c.dim}Orphans:${c.reset} ${pass2Result.metadata.orphan_statements}`);
        console.log(`  ${c.dim}Coverage:${c.reset} ${pass2Result.metadata.coverage_percentage}%`);
        if (pass2Result.metadata.contradictions_detected > 0) {
          printWarn(`Contradictions detected: ${pass2Result.metadata.contradictions_detected}`);
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'statement-map':
      // Show statement map
      const stmtMap = loadStatementMap();
      if (!stmtMap) {
        console.error(`${c.red}No statement map found - run pass2 first${c.reset}`);
        process.exit(1);
      }
      console.log(JSON.stringify(stmtMap, null, 2));
      break;

    case 'orphans':
      // Show orphan statements
      const orphanMap = loadStatementMap();
      if (!orphanMap) {
        console.error(`${c.red}No statement map found - run pass2 first${c.reset}`);
        process.exit(1);
      }
      const orphanStmts = orphanMap.statements.filter(s => s.meaningful && s.topic_id === null);
      if (orphanStmts.length === 0) {
        console.log(`${c.green}✓ No orphan statements - 100% coverage${c.reset}`);
      } else {
        console.log(`${c.yellow}Orphan statements (${orphanStmts.length}):${c.reset}\n`);
        for (const orphan of orphanStmts) {
          console.log(`${c.dim}${orphan.id}:${c.reset} "${orphan.text.slice(0, 80)}..."`);
          if (orphan.clarification_question) {
            console.log(`  ${c.cyan}→ ${orphan.clarification_question}${c.reset}`);
          }
        }
      }
      break;

    case 'contradictions':
      // Show contradictions
      const contradictMap = loadStatementMap();
      if (!contradictMap) {
        console.error(`${c.red}No statement map found - run pass2 first${c.reset}`);
        process.exit(1);
      }
      const contradicts = contradictMap.contradictions || [];
      if (contradicts.length === 0) {
        console.log(`${c.green}✓ No contradictions detected${c.reset}`);
      } else {
        console.log(`${c.yellow}Contradictions (${contradicts.length}):${c.reset}\n`);
        for (const contra of contradicts) {
          const stmt1 = contradictMap.statements.find(s => s.id === contra.statement1_id);
          const stmt2 = contradictMap.statements.find(s => s.id === contra.statement2_id);
          console.log(`${c.red}${contra.type}:${c.reset} ${contra.attribute || contra.values?.join(' vs ')}`);
          console.log(`  ${c.dim}${contra.statement1_id}:${c.reset} "${stmt1?.text.slice(0, 60)}..."`);
          console.log(`  ${c.dim}${contra.statement2_id}:${c.reset} "${stmt2?.text.slice(0, 60)}..."`);
          console.log();
        }
      }
      break;

    case 'pass3':
    case 'resolve-orphans':
      // Run Pass 3: Orphan Check
      try {
        const pass3Result = runPass3();
        console.log(`${c.green}✓ Pass 3 complete${c.reset}`);
        console.log(`${c.cyan}Coverage:${c.reset} ${pass3Result.coverage.percentage}%`);
        console.log(`  ${c.dim}Total meaningful:${c.reset} ${pass3Result.coverage.total_meaningful}`);
        console.log(`  ${c.dim}Mapped:${c.reset} ${pass3Result.coverage.mapped}`);
        console.log(`  ${c.dim}Resolved:${c.reset} ${pass3Result.resolved.length}`);
        if (pass3Result.new_topics_created.length > 0) {
          console.log(`${c.cyan}New topics created:${c.reset} ${pass3Result.new_topics_created.length}`);
          for (const t of pass3Result.new_topics_created) {
            console.log(`  ${c.dim}${t.id}:${c.reset} ${t.title}`);
          }
        }
        if (pass3Result.orphans.length > 0) {
          printWarn(`Still need clarification: ${pass3Result.orphans.length}`);
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'coverage':
      // Show coverage summary
      const orphanData = loadOrphans();
      if (!orphanData) {
        const stmtMapCov = loadStatementMap();
        if (stmtMapCov) {
          console.log(`${c.cyan}Coverage:${c.reset} ${stmtMapCov.metadata.coverage_percentage}%`);
          console.log(`  ${c.dim}Meaningful:${c.reset} ${stmtMapCov.metadata.meaningful_statements}`);
          console.log(`  ${c.dim}Mapped:${c.reset} ${stmtMapCov.metadata.mapped_statements}`);
          console.log(`  ${c.dim}Orphans:${c.reset} ${stmtMapCov.metadata.orphan_statements}`);
        } else {
          console.error(`${c.red}No data found - run pass2 first${c.reset}`);
          process.exit(1);
        }
      } else {
        console.log(`${c.cyan}Coverage:${c.reset} ${orphanData.coverage.percentage}%`);
        console.log(`  ${c.dim}Total meaningful:${c.reset} ${orphanData.coverage.total_meaningful}`);
        console.log(`  ${c.dim}Mapped:${c.reset} ${orphanData.coverage.mapped}`);
        console.log(`  ${c.dim}Need clarification:${c.reset} ${orphanData.coverage.clarification_needed}`);
        if (orphanData.coverage.percentage < 100) {
          console.log(`\n${c.yellow}Run 'pass3' to resolve orphans${c.reset}`);
        } else {
          console.log(`\n${c.green}✓ 100% coverage achieved${c.reset}`);
        }
      }
      break;

    case 'pass4':
    case 'resolve-contradictions':
      // Run Pass 4: Contradiction Resolution
      try {
        const pass4Result = runPass4();
        console.log(`${c.green}✓ Pass 4 complete${c.reset}`);
        console.log(`${c.cyan}Contradictions:${c.reset} ${pass4Result.stats.total} total`);
        console.log(`  ${c.dim}Auto-resolved:${c.reset} ${pass4Result.stats.auto_resolved}`);
        console.log(`  ${c.dim}Need clarification:${c.reset} ${pass4Result.stats.needs_clarification}`);
        console.log(`  ${c.dim}Additive (not contradictions):${c.reset} ${pass4Result.stats.additive_not_contradiction}`);
        if (pass4Result.resolved.length > 0) {
          console.log(`\n${c.cyan}Auto-resolved:${c.reset}`);
          for (const r of pass4Result.resolved) {
            console.log(`  ${c.dim}Winner:${c.reset} ${r.winner} (${r.reason})`);
          }
        }
        if (pass4Result.pending.length > 0) {
          console.log(`\n${c.yellow}Need clarification:${c.reset}`);
          for (const p of pass4Result.pending) {
            console.log(`  ${c.dim}${p.clarification_id}:${c.reset} ${p.statement1_id} vs ${p.statement2_id}`);
          }
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'clarifications':
      // Show clarification questions
      const clars = loadClarifications();
      if (!clars) {
        console.error(`${c.red}No clarifications found${c.reset}`);
        process.exit(1);
      }
      const pendingClars = clars.contradictions.filter(c => c.status === 'pending');
      if (pendingClars.length === 0) {
        console.log(`${c.green}✓ No pending clarifications${c.reset}`);
      } else {
        console.log(`${c.yellow}Pending clarifications (${pendingClars.length}):${c.reset}\n`);
        for (const clar of pendingClars) {
          console.log(`${c.cyan}${clar.id}:${c.reset} ${clar.question}`);
          for (const opt of clar.options) {
            console.log(`  ${c.dim}${opt.id}:${c.reset} ${opt.text}`);
          }
          console.log();
        }
      }
      break;

    case 'questions':
    case 'generate-questions':
      // Generate clarifying questions
      try {
        const qResult = generateAllQuestions();
        console.log(`${c.green}✓ Question generation complete${c.reset}`);
        console.log(`${c.cyan}Questions generated:${c.reset} ${qResult.stats.total}`);
        console.log(`  ${c.dim}Completeness:${c.reset} ${qResult.stats.by_type.completeness || 0}`);
        console.log(`  ${c.dim}Specificity:${c.reset} ${qResult.stats.by_type.specificity || 0}`);
        console.log(`  ${c.dim}Ambiguity:${c.reset} ${qResult.stats.by_type.ambiguity || 0}`);
        console.log(`\n${c.cyan}By priority:${c.reset}`);
        console.log(`  ${c.red}P1 (High):${c.reset} ${qResult.stats.by_priority.P1 || 0}`);
        console.log(`  ${c.yellow}P2 (Medium):${c.reset} ${qResult.stats.by_priority.P2 || 0}`);
        console.log(`  ${c.dim}P3 (Low):${c.reset} ${qResult.stats.by_priority.P3 || 0}`);
        console.log(`\n${c.dim}Topics with questions: ${qResult.stats.topics_with_questions}${c.reset}`);
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'show-questions':
      // Show all pending questions grouped by topic
      const showClars = loadClarifications();
      if (!showClars) {
        console.error(`${c.red}No clarifications found - run 'questions' first${c.reset}`);
        process.exit(1);
      }
      const allPending = showClars.questions.filter(q => q.status === 'pending');
      if (allPending.length === 0) {
        console.log(`${c.green}✓ No pending questions${c.reset}`);
      } else {
        // Group by topic
        const byTopicShow = {};
        for (const q of allPending) {
          if (!byTopicShow[q.topic_id]) {
            byTopicShow[q.topic_id] = { title: q.topic_title, questions: [] };
          }
          byTopicShow[q.topic_id].questions.push(q);
        }
        console.log(`${c.cyan}Pending questions (${allPending.length}):${c.reset}\n`);
        for (const [topicId, data] of Object.entries(byTopicShow)) {
          console.log(`${c.green}## ${data.title || topicId} (${data.questions.length})${c.reset}`);
          for (let i = 0; i < data.questions.length; i++) {
            const q = data.questions[i];
            const prioColor = q.priority === 'P1' ? c.red : q.priority === 'P2' ? c.yellow : c.dim;
            console.log(`\n${prioColor}${i + 1}. [${q.priority}]${c.reset} ${q.question}`);
            if (q.examples) {
              console.log(`   ${c.dim}Examples: ${q.examples.join(' | ')}${c.reset}`);
            }
          }
          console.log();
        }
      }
      break;

    // E2-S2: Conversation Loop Commands
    case 'answer':
      // Process user answer
      const forceVoice = args.includes('--voice');
      const filteredArgs = args.filter(a => a !== '--voice');

      let answerText;
      if (!filteredArgs[1] || filteredArgs[1] === '-') {
        answerText = fs.readFileSync(0, 'utf8').trim();
      } else {
        answerText = filteredArgs.slice(1).join(' ');
      }

      if (!answerText) {
        console.error(`${c.red}Usage: flow transcript-digest answer [--voice] "<response>"${c.reset}`);
        process.exit(1);
      }

      try {
        const answerResult = processConversationResponse(answerText, { forceVoice });

        if (answerResult.error) {
          console.error(`${c.red}Error: ${answerResult.error}${c.reset}`);
          process.exit(1);
        }

        if (answerResult.complete) {
          console.log(`${c.green}✓ ${answerResult.message || 'All clarifications complete!'}${c.reset}`);
          break;
        }

        // Show voice processing info if applicable
        if (answerResult.voice) {
          console.log(`${c.cyan}Voice input detected${c.reset}`);
          if (answerResult.voice.processing.fillersRemoved > 0) {
            console.log(`  ${c.dim}Fillers removed:${c.reset} ${answerResult.voice.processing.fillersRemoved}`);
          }
          if (answerResult.voice.processing.corrections.length > 0) {
            console.log(`  ${c.dim}Self-corrections:${c.reset} ${answerResult.voice.processing.corrections.length}`);
          }
          if (answerResult.voice.processing.numbersNormalized > 0) {
            console.log(`  ${c.dim}Numbers normalized:${c.reset} ${answerResult.voice.processing.numbersNormalized}`);
          }
          if (answerResult.voice.processing.uncertainty.hasUncertainty) {
            console.log(`  ${c.yellow}Uncertainty detected:${c.reset} ${answerResult.voice.processing.uncertainty.markers.join(', ')}`);
          }
          console.log(`  ${c.dim}Normalized:${c.reset} "${answerResult.voice.normalized}"`);
          console.log();
        }

        console.log(`${c.green}✓ Captured ${answerResult.captured.length} answer(s)${c.reset}`);
        for (const cap of answerResult.captured) {
          console.log(`  ${c.dim}${cap.question_id}:${c.reset} "${cap.answer.slice(0, 50)}..."`);
        }

        if (answerResult.derived_statements.length > 0) {
          console.log(`\n${c.cyan}Created ${answerResult.derived_statements.length} derived statement(s)${c.reset}`);
        }

        if (answerResult.followups_added.length > 0) {
          console.log(`\n${c.yellow}Added ${answerResult.followups_added.length} follow-up question(s)${c.reset}`);
        }

        console.log(`\n${c.dim}Remaining: ${answerResult.remaining_questions} question(s)${c.reset}`);

        if (answerResult.formatted_questions) {
          console.log(`\n${c.cyan}Next questions:${c.reset}\n`);
          console.log(answerResult.formatted_questions);
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'next-questions':
      // Get next batch of questions for presentation
      const limitArg = parseInt(args[1], 10) || 5;
      const topicArg = args[2] || null;

      const nextQs = getQuestionsForPresentation(topicArg, limitArg);
      if (nextQs.length === 0) {
        console.log(`${c.green}✓ No pending questions${c.reset}`);
      } else {
        const formatted = formatQuestionsForUser(nextQs);
        console.log(formatted);
      }
      break;

    case 'completion-status':
    case 'check-completion':
      // Check if all clarifications are complete
      const completion = checkCompletion();

      if (completion.error) {
        console.error(`${c.red}Error: ${completion.error}${c.reset}`);
        process.exit(1);
      }

      if (completion.complete) {
        console.log(`${c.green}✓ All clarifications complete!${c.reset}`);
      } else {
        console.log(`${c.yellow}Clarification in progress${c.reset}`);
      }

      console.log(`\n${c.cyan}Questions:${c.reset}`);
      console.log(`  ${c.dim}Total:${c.reset} ${completion.total_questions}`);
      console.log(`  ${c.green}Answered:${c.reset} ${completion.answered_questions}`);
      console.log(`  ${c.yellow}Pending:${c.reset} ${completion.pending_questions}`);

      if (completion.total_contradictions > 0) {
        console.log(`\n${c.cyan}Contradictions:${c.reset}`);
        console.log(`  ${c.dim}Total:${c.reset} ${completion.total_contradictions}`);
        console.log(`  ${c.green}Resolved:${c.reset} ${completion.resolved_contradictions}`);
        console.log(`  ${c.yellow}Pending:${c.reset} ${completion.pending_contradictions}`);
      }

      // Output JSON for programmatic use
      if (args.includes('--json')) {
        console.log(`\n${JSON.stringify(completion, null, 2)}`);
      }
      break;

    case 'resolve-contradiction':
      // Resolve a contradiction with user choice
      const contraId = args[1];
      const contraChoice = args[2];

      if (!contraId || !contraChoice) {
        console.error(`${c.red}Usage: flow transcript-digest resolve-contradiction <id> <choice>${c.reset}`);
        console.error(`${c.dim}Choices: opt-1, opt-2, keep_both${c.reset}`);
        process.exit(1);
      }

      try {
        const resolved = resolveContradictionWithChoice(contraId, contraChoice);
        console.log(`${c.green}✓ Resolved contradiction ${contraId}${c.reset}`);
        console.log(`  ${c.dim}Resolution:${c.reset} ${resolved.resolution}`);
        if (resolved.winner) {
          console.log(`  ${c.dim}Winner:${c.reset} ${resolved.winner}`);
        }
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    case 'voice-normalize':
    case 'normalize-voice':
      // Test voice normalization without a digest session
      let voiceText;
      if (!args[1] || args[1] === '-') {
        voiceText = fs.readFileSync(0, 'utf8').trim();
      } else {
        voiceText = args.slice(1).join(' ');
      }

      if (!voiceText) {
        console.error(`${c.red}Usage: flow transcript-digest voice-normalize "<voice text>"${c.reset}`);
        process.exit(1);
      }

      const voiceNormResult = processVoiceAnswer(voiceText, true);
      console.log(`${c.cyan}Voice Normalization Result${c.reset}\n`);
      console.log(`${c.dim}Original:${c.reset} "${voiceText}"`);
      console.log(`${c.green}Normalized:${c.reset} "${voiceNormResult.normalized}"`);
      console.log(`\n${c.dim}Voice detected:${c.reset} ${voiceNormResult.isVoice ? 'Yes' : 'No'}`);
      console.log(`${c.dim}Confidence:${c.reset} ${(voiceNormResult.confidence * 100).toFixed(0)}%`);

      if (voiceNormResult.processing.fillersRemoved > 0) {
        console.log(`${c.dim}Fillers removed:${c.reset} ${voiceNormResult.processing.fillersRemoved}`);
      }
      if (voiceNormResult.processing.corrections.length > 0) {
        console.log(`${c.dim}Corrections:${c.reset}`);
        for (const corr of voiceNormResult.processing.corrections) {
          console.log(`  ${c.yellow}${corr.type}:${c.reset} "${corr.original}" → "${corr.corrected}"`);
        }
      }
      if (voiceNormResult.processing.numbersNormalized > 0) {
        console.log(`${c.dim}Numbers normalized:${c.reset} ${voiceNormResult.processing.numbersNormalized}`);
      }
      if (voiceNormResult.processing.uncertainty.hasUncertainty) {
        console.log(`${c.yellow}Uncertainty:${c.reset} ${voiceNormResult.processing.uncertainty.markers.join(', ')}`);
        if (voiceNormResult.processing.uncertainty.needsConfirmation) {
          console.log(`  ${c.yellow}→ May need confirmation${c.reset}`);
        }
      }
      if (voiceNormResult.processing.yesNo.type) {
        console.log(`${c.green}Yes/No detected:${c.reset} ${voiceNormResult.processing.yesNo.type}`);
      }
      break;

    case 'capture-answer':
      // Manually capture answer for a specific question
      const qId = args[1];
      const qAnswer = args.slice(2).join(' ');

      if (!qId || !qAnswer) {
        console.error(`${c.red}Usage: flow transcript-digest capture-answer <question-id> <answer>${c.reset}`);
        process.exit(1);
      }

      try {
        const captured = captureAnswer(qId, qAnswer, 'manual');
        console.log(`${c.green}✓ Captured answer for ${qId}${c.reset}`);

        // Create derived statement
        const derived = createDerivedStatement(captured, qAnswer);
        console.log(`${c.dim}Created statement:${c.reset} ${derived.id}`);

        // Check for follow-ups
        const followups = checkFollowups(qAnswer, captured);
        if (followups.length > 0) {
          const added = addFollowupQuestions(followups);
          if (added.length > 0) {
            console.log(`${c.yellow}Added ${added.length} follow-up question(s)${c.reset}`);
          }
        }

        // Check completion
        const compStatus = checkCompletion();
        console.log(`\n${c.dim}Remaining: ${compStatus.pending_questions} question(s)${c.reset}`);
      } catch (err) {
        console.error(`${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
      }
      break;

    // E2-S4: Persistence Commands
    case 'resume':
      // Resume an interrupted session
      const interrupted = detectInterruptedSession();

      if (!interrupted.interrupted) {
        console.log(`${c.dim}No interrupted session to resume${c.reset}`);
        break;
      }

      printWarn('Interrupted session detected');
      console.log(`  ${c.dim}Session:${c.reset} ${interrupted.session_id}`);
      console.log(`  ${c.dim}Last active:${c.reset} ${interrupted.time_since_formatted}`);
      console.log(`  ${c.dim}Progress:${c.reset} ${interrupted.answered_questions}/${interrupted.total_questions} questions answered`);
      console.log();

      const resumeResult = resumeSession();
      if (resumeResult.error) {
        console.error(`${c.red}Error: ${resumeResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Session resumed${c.reset}\n`);

      if (resumeResult.summary.recent_answers.length > 0) {
        console.log(`${c.cyan}Recent answers:${c.reset}`);
        for (const ans of resumeResult.summary.recent_answers.slice(-3)) {
          console.log(`  ${c.dim}${ans.topic}:${c.reset} "${ans.answer.slice(0, 40)}..."`);
        }
        console.log();
      }

      if (resumeResult.formatted_questions) {
        console.log(`${c.cyan}Continuing with questions:${c.reset}\n`);
        console.log(resumeResult.formatted_questions);
      }
      break;

    case 'review':
      // Review all answered questions
      const reviewResult = reviewAnswers();

      if (reviewResult.error) {
        console.error(`${c.red}Error: ${reviewResult.error}${c.reset}`);
        process.exit(1);
      }

      if (reviewResult.total_answered === 0) {
        console.log(`${c.dim}No answered questions yet${c.reset}`);
        break;
      }

      console.log(`${c.cyan}Answered Questions (${reviewResult.total_answered})${c.reset}\n`);

      for (const [topic, questions] of Object.entries(reviewResult.by_topic)) {
        console.log(`${c.green}## ${topic}${c.reset}`);
        for (const q of questions) {
          console.log(`\n${c.dim}Q:${c.reset} ${q.question}`);
          console.log(`${c.green}A:${c.reset} ${q.answer}`);
          if (q.source === 'voice') {
            console.log(`${c.dim}(voice input)${c.reset}`);
          }
        }
        console.log();
      }
      break;

    case 'history':
      // Show session interaction history
      const historyResult = getSessionHistory();

      if (!historyResult) {
        console.log(`${c.dim}No session history available${c.reset}`);
        break;
      }

      console.log(`${c.cyan}Session History${c.reset}\n`);
      console.log(`${c.dim}Session ID:${c.reset} ${historyResult.session_id}`);
      console.log(`${c.dim}Started:${c.reset} ${historyResult.started_at}`);
      console.log(`${c.dim}Last interaction:${c.reset} ${historyResult.last_interaction}`);
      console.log(`${c.dim}Interactions:${c.reset} ${historyResult.interaction_count}`);
      console.log(`${c.dim}Checkpoints:${c.reset} ${historyResult.checkpoint_count}`);
      console.log(`${c.dim}Answers given:${c.reset} ${historyResult.answers_given}`);

      if (Object.keys(historyResult.interactions_by_type).length > 0) {
        console.log(`\n${c.cyan}Interactions by type:${c.reset}`);
        for (const [type, count] of Object.entries(historyResult.interactions_by_type)) {
          console.log(`  ${c.dim}${type}:${c.reset} ${count}`);
        }
      }
      break;

    case 'export':
      // Export session state
      const exportFormat = args.includes('--format') ?
        args[args.indexOf('--format') + 1] || 'json' : 'json';

      const exportResult = exportSession(exportFormat);

      if (exportResult.error) {
        console.error(`${c.red}Error: ${exportResult.error}${c.reset}`);
        process.exit(1);
      }

      if (exportFormat === 'md') {
        console.log(exportResult);
      } else {
        console.log(JSON.stringify(exportResult, null, 2));
      }
      break;

    case 'complexity':
      // Analyze complexity of extracted requirements
      const complexityResult = analyzeComplexity();

      if (complexityResult.error) {
        console.error(`${c.red}Error: ${complexityResult.error}${c.reset}`);
        process.exit(1);
      }

      // Check if JSON output requested
      if (args.includes('--json')) {
        console.log(JSON.stringify(complexityResult, null, 2));
        break;
      }

      // Human-readable output
      console.log(`${c.cyan}Complexity Analysis${c.reset}\n`);

      // Overall score
      const levelColor = complexityResult.overall.level === 'simple' || complexityResult.overall.level === 'low'
        ? c.green
        : complexityResult.overall.level === 'medium' ? c.yellow : c.red;
      console.log(`Overall Score: ${levelColor}${complexityResult.overall.score}/100 (${complexityResult.overall.level.replace('_', ' ')})${c.reset}`);
      console.log(`${c.dim}${complexityResult.overall.description}${c.reset}\n`);

      // Factors
      console.log(`${c.cyan}Factors:${c.reset}`);
      console.log(`  Topics: ${complexityResult.factors.topic_count}`);
      console.log(`  Statements: ${complexityResult.factors.statement_count}`);
      console.log(`  Questions: ${complexityResult.factors.question_count}`);
      console.log(`  Contradictions: ${complexityResult.factors.contradiction_count}`);
      console.log(`  UI Components: ${complexityResult.factors.ui_components}`);
      console.log(`  Data Entities: ${complexityResult.factors.data_entities}`);
      console.log(`  Interactions: ${complexityResult.factors.interactions}\n`);

      // Topic breakdown
      if (complexityResult.topic_analysis.length > 0) {
        console.log(`${c.cyan}Topic Breakdown:${c.reset}`);
        for (const topic of complexityResult.topic_analysis) {
          const topicLevel = topic.complexity_score <= 30 ? 'Low' :
            topic.complexity_score <= 60 ? 'Medium' : 'High';
          console.log(`  ${topic.title}: ${topic.complexity_score} (${topicLevel}) - ${topic.estimated_stories} ${topic.estimated_stories === 1 ? 'story' : 'stories'}`);
        }
        console.log();
      }

      // Recommendation
      console.log(`${c.cyan}Recommended Structure:${c.reset} ${complexityResult.recommendation.type.replace('_', ' ')}`);
      console.log(`${c.dim}${complexityResult.recommendation.rationale}${c.reset}`);

      if (complexityResult.recommendation.type === 'epic' && complexityResult.recommendation.epics) {
        console.log(`\n${c.cyan}Proposed Epics:${c.reset}`);
        for (const epic of complexityResult.recommendation.epics) {
          console.log(`  - ${epic.title} (${epic.stories} ${epic.stories === 1 ? 'story' : 'stories'})`);
        }
      } else if (complexityResult.recommendation.type === 'story_group' && complexityResult.recommendation.groups) {
        console.log(`\n${c.cyan}Story Groups:${c.reset}`);
        for (const group of complexityResult.recommendation.groups) {
          console.log(`  - ${group.topics.join(', ')} (${group.stories} ${group.stories === 1 ? 'story' : 'stories'})`);
        }
      }

      // Entity summary
      if (complexityResult.entity_summary.ui_components.length > 0 ||
          complexityResult.entity_summary.data_entities.length > 0) {
        console.log(`\n${c.cyan}Detected Entities:${c.reset}`);
        if (complexityResult.entity_summary.ui_components.length > 0) {
          console.log(`  UI: ${complexityResult.entity_summary.ui_components.join(', ')}`);
        }
        if (complexityResult.entity_summary.data_entities.length > 0) {
          console.log(`  Data: ${complexityResult.entity_summary.data_entities.join(', ')}`);
        }
        if (complexityResult.entity_summary.interactions.length > 0) {
          console.log(`  Actions: ${complexityResult.entity_summary.interactions.join(', ')}`);
        }
      }
      break;

    case 'generate-story':
      // Generate story for a specific topic
      const storyTopicId = args[1];
      if (!storyTopicId) {
        console.error(`${c.red}Error: Topic ID required. Usage: generate-story <topic-id>${c.reset}`);
        process.exit(1);
      }

      const singleStory = generateStoryFromTopic(storyTopicId);
      if (singleStory.error) {
        console.error(`${c.red}Error: ${singleStory.error}${c.reset}`);
        process.exit(1);
      }

      // Save the story
      const saveResult = saveStory(singleStory);
      if (saveResult.error) {
        console.error(`${c.red}Error: ${saveResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(singleStory, null, 2));
      } else if (args.includes('--md')) {
        console.log(formatStoryAsMarkdown(singleStory));
      } else {
        console.log(`${c.green}✓ Story generated${c.reset}`);
        console.log(`${c.cyan}ID:${c.reset} ${singleStory.id}`);
        console.log(`${c.cyan}Topic:${c.reset} ${singleStory.title}`);
        console.log(`${c.cyan}Acceptance Criteria:${c.reset} ${singleStory.acceptance_criteria.length}`);
        console.log(`${c.cyan}Coverage:${c.reset} ${singleStory.coverage.coverage_percent}%`);
        console.log(`${c.cyan}Saved to:${c.reset} ${saveResult.path}`);

        if (singleStory.validation.warnings.length > 0) {
          console.log(`\n${c.yellow}Warnings:${c.reset}`);
          for (const w of singleStory.validation.warnings) {
            console.log(`  ${c.dim}${w.type}:${c.reset} ${w.message}`);
          }
        }
      }
      break;

    case 'generate-stories':
      // Generate stories for all topics
      const allStoriesResult = generateAllStories();

      if (allStoriesResult.error) {
        console.error(`${c.red}Error: ${allStoriesResult.error}${c.reset}`);
        process.exit(1);
      }

      // Save all stories
      for (const st of allStoriesResult.stories) {
        saveStory(st);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(allStoriesResult, null, 2));
      } else {
        console.log(`${c.green}✓ Story generation complete${c.reset}\n`);
        console.log(`${c.cyan}Summary:${c.reset}`);
        console.log(`  Topics: ${allStoriesResult.summary.total_topics}`);
        console.log(`  Stories generated: ${allStoriesResult.summary.stories_generated}`);
        console.log(`  Total criteria: ${allStoriesResult.summary.total_criteria}`);
        console.log(`  Average coverage: ${allStoriesResult.summary.average_coverage}%`);

        if (allStoriesResult.errors.length > 0) {
          console.log(`\n${c.yellow}Errors (${allStoriesResult.errors.length}):${c.reset}`);
          for (const err of allStoriesResult.errors) {
            console.log(`  ${c.dim}${err.topic_id}:${c.reset} ${err.error}`);
          }
        }

        console.log(`\n${c.cyan}Generated stories:${c.reset}`);
        for (const st of allStoriesResult.stories) {
          const coverageColor = st.coverage.coverage_percent >= 80 ? c.green :
            st.coverage.coverage_percent >= 50 ? c.yellow : c.red;
          console.log(`  ${st.id}: ${st.title} - ${coverageColor}${st.coverage.coverage_percent}% coverage${c.reset}`);
        }
      }
      break;

    case 'show-story':
      // Show a specific story
      const showStoryId = args[1];
      if (!showStoryId) {
        console.error(`${c.red}Error: Story ID required. Usage: show-story <story-id>${c.reset}`);
        process.exit(1);
      }

      const storyToShow = loadStory(showStoryId);
      if (!storyToShow) {
        console.error(`${c.red}Error: Story ${showStoryId} not found${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(storyToShow, null, 2));
      } else {
        console.log(formatStoryAsMarkdown(storyToShow));
      }
      break;

    case 'list-stories':
      // List all generated stories
      const allStories = loadAllStories();

      if (allStories.length === 0) {
        console.log(`${c.dim}No stories generated yet${c.reset}`);
        break;
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(allStories.map(s => ({
          id: s.id,
          topic_id: s.topic_id,
          title: s.title,
          criteria_count: s.acceptance_criteria.length,
          coverage: s.coverage.coverage_percent
        })), null, 2));
      } else {
        console.log(`${c.cyan}Generated Stories (${allStories.length})${c.reset}\n`);
        for (const st of allStories) {
          const coverageColor = st.coverage.coverage_percent >= 80 ? c.green :
            st.coverage.coverage_percent >= 50 ? c.yellow : c.red;
          console.log(`${c.dim}${st.id}${c.reset}`);
          console.log(`  Title: ${st.title}`);
          console.log(`  Topic: ${st.topic_id}`);
          console.log(`  Criteria: ${st.acceptance_criteria.length}`);
          console.log(`  Coverage: ${coverageColor}${st.coverage.coverage_percent}%${c.reset}`);
          console.log();
        }
      }
      break;

    case 'validate-stories':
      // Validate all stories for coverage
      const storiesToValidate = loadAllStories();

      if (storiesToValidate.length === 0) {
        console.log(`${c.dim}No stories to validate${c.reset}`);
        break;
      }

      let allValid = true;
      const validationResults = [];

      for (const st of storiesToValidate) {
        const result = {
          id: st.id,
          title: st.title,
          valid: st.validation.valid,
          coverage: st.coverage.coverage_percent,
          warnings: st.validation.warnings
        };
        validationResults.push(result);
        if (!result.valid || result.warnings.length > 0) {
          allValid = false;
        }
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify({ all_valid: allValid, stories: validationResults }, null, 2));
      } else {
        console.log(`${c.cyan}Story Validation${c.reset}\n`);

        for (const result of validationResults) {
          const statusIcon = result.valid && result.warnings.length === 0 ? `${c.green}✓${c.reset}` : `${c.yellow}⚠${c.reset}`;
          console.log(`${statusIcon} ${result.id}: ${result.title}`);
          console.log(`  Coverage: ${result.coverage}%`);

          if (result.warnings.length > 0) {
            for (const w of result.warnings) {
              console.log(`  ${c.yellow}${w.type}:${c.reset} ${w.message}`);
            }
          }
          console.log();
        }

        if (allValid) {
          console.log(`${c.green}✓ All stories valid with full coverage${c.reset}`);
        } else {
          printWarn('Some stories have warnings');
        }
      }
      break;

    // E3-S3: Presentation Flow Commands
    case 'present':
    case 'present-next':
      // Start/continue presentation - show next story
      const presentResult = getNextStory();

      if (presentResult.error) {
        console.error(`${c.red}Error: ${presentResult.error}${c.reset}`);
        process.exit(1);
      }

      if (presentResult.complete) {
        console.log(`${c.green}╔══════════════════════════════════════════════════════════════╗${c.reset}`);
        console.log(`${c.green}║                    PRESENTATION COMPLETE                      ║${c.reset}`);
        console.log(`${c.green}╠══════════════════════════════════════════════════════════════╣${c.reset}`);
        console.log(`${c.green}║${c.reset}                                                              ${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}  Total Stories: ${presentResult.summary.total.toString().padEnd(41)}${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}                                                              ${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}  ${c.green}✓${c.reset} Approved: ${presentResult.summary.approved.toString().padEnd(44)}${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}  ${c.red}✗${c.reset} Rejected: ${presentResult.summary.rejected.toString().padEnd(44)}${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}  ○ Skipped:  ${presentResult.summary.skipped.toString().padEnd(44)}${c.green}║${c.reset}`);
        console.log(`${c.green}║${c.reset}                                                              ${c.green}║${c.reset}`);
        console.log(`${c.green}╚══════════════════════════════════════════════════════════════╝${c.reset}`);

        const completionSummary = getCompletionSummary();
        if (completionSummary.approved.length > 0) {
          console.log(`\n${c.green}Approved Stories:${c.reset}`);
          for (const s of completionSummary.approved) {
            console.log(`  - ${s.title}`);
          }
        }
        if (completionSummary.rejected.length > 0) {
          console.log(`\n${c.red}Rejected Stories:${c.reset}`);
          for (const s of completionSummary.rejected) {
            console.log(`  - ${s.title}: "${s.reason}"`);
          }
        }
        console.log(`\n${c.dim}Next steps:${c.reset}`);
        console.log(`  - Edit rejected stories: flow transcript-digest edit-story <id>`);
        console.log(`  - Export approved: flow transcript-digest export-approved`);
        console.log(`  - Add to ready.json: flow transcript-digest finalize`);
        break;
      }

      // Show story summary
      console.log(formatStorySummary(presentResult));
      console.log(formatActionsPrompt());
      break;

    case 'approve':
      // Approve current story
      const approveResult = approveCurrentStory();

      if (approveResult.error) {
        console.error(`${c.red}Error: ${approveResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Approved: ${approveResult.title}${c.reset}`);

      // Auto-advance to next story
      const nextAfterApprove = getNextStory();
      if (nextAfterApprove.complete) {
        console.log(`\n${c.green}All stories reviewed!${c.reset}`);
        console.log(`${c.dim}Run 'present' to see completion summary.${c.reset}`);
      } else if (!nextAfterApprove.error) {
        console.log(`\n${c.cyan}Next story:${c.reset}\n`);
        console.log(formatStorySummary(nextAfterApprove));
        console.log(formatActionsPrompt());
      }
      break;

    case 'reject':
      // Reject current story with reason
      const rejectReason = args.slice(1).join(' ') || 'No reason provided';

      const rejectResult = rejectCurrentStory(rejectReason);

      if (rejectResult.error) {
        console.error(`${c.red}Error: ${rejectResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.red}✗ Rejected: ${rejectResult.title}${c.reset}`);
      console.log(`${c.dim}Reason: ${rejectResult.reason}${c.reset}`);

      // Auto-advance to next story
      const nextAfterReject = getNextStory();
      if (nextAfterReject.complete) {
        console.log(`\n${c.green}All stories reviewed!${c.reset}`);
        console.log(`${c.dim}Run 'present' to see completion summary.${c.reset}`);
      } else if (!nextAfterReject.error) {
        console.log(`\n${c.cyan}Next story:${c.reset}\n`);
        console.log(formatStorySummary(nextAfterReject));
        console.log(formatActionsPrompt());
      }
      break;

    case 'skip':
      // Skip current story for later
      const skipResult = skipCurrentStory();

      if (skipResult.error) {
        console.error(`${c.red}Error: ${skipResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.yellow}○ Skipped: ${skipResult.title}${c.reset}`);

      // Auto-advance to next story
      const nextAfterSkip = getNextStory();
      if (nextAfterSkip.complete) {
        console.log(`\n${c.green}All stories reviewed!${c.reset}`);
        console.log(`${c.dim}Run 'present' to see completion summary.${c.reset}`);
      } else if (!nextAfterSkip.error) {
        console.log(`\n${c.cyan}Next story:${c.reset}\n`);
        console.log(formatStorySummary(nextAfterSkip));
        console.log(formatActionsPrompt());
      }
      break;

    case 'view-current':
    case 'view-story':
      // View current story in full
      const currentStory = getCurrentStory();

      if (currentStory.error) {
        console.error(`${c.red}Error: ${currentStory.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`\n${c.cyan}Story ${currentStory.index} of ${currentStory.total}${c.reset}\n`);
      console.log(formatStoryAsMarkdown(currentStory.story));
      console.log(formatActionsPrompt());
      break;

    case 'presentation-status':
      // Show presentation status
      const presStatus = getPresentationStatus();

      if (!presStatus.active) {
        console.log(`${c.dim}No presentation in progress${c.reset}`);
        console.log(`${c.dim}Run 'present' to start presenting stories.${c.reset}`);
        break;
      }

      console.log(`${c.cyan}Presentation Status${c.reset}\n`);
      console.log(`Status: ${presStatus.status}`);
      console.log(`Current: ${presStatus.current || 'none'}`);
      console.log(`\n${c.cyan}Progress:${c.reset}`);
      console.log(`  Reviewed: ${presStatus.progress.reviewed}/${presStatus.progress.total}`);
      console.log(`  Remaining: ${presStatus.progress.remaining}`);
      console.log(`\n${c.cyan}Summary:${c.reset}`);
      console.log(`  ${c.green}Approved:${c.reset} ${presStatus.summary.approved}`);
      console.log(`  ${c.red}Rejected:${c.reset} ${presStatus.summary.rejected}`);
      console.log(`  ${c.yellow}Skipped:${c.reset} ${presStatus.summary.skipped}`);
      console.log(`  ${c.dim}Pending:${c.reset} ${presStatus.summary.pending}`);
      break;

    case 'reset-presentation':
      // Reset presentation to start over
      const resetResult = resetPresentation();

      if (resetResult.error) {
        console.error(`${c.red}Error: ${resetResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Presentation reset${c.reset}`);
      console.log(`${c.dim}${resetResult.total} stories ready for review.${c.reset}`);
      console.log(`${c.dim}Run 'present' to start.${c.reset}`);
      break;

    case 'completion-summary':
      // Show completion summary
      const compSummary = getCompletionSummary();

      if (compSummary.error) {
        console.error(`${c.red}Error: ${compSummary.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(compSummary, null, 2));
        break;
      }

      console.log(`${c.cyan}Presentation Summary${c.reset}\n`);
      console.log(`Complete: ${compSummary.complete ? 'Yes' : 'No'}`);
      console.log(`Total: ${compSummary.summary.total}`);
      console.log(`${c.green}Approved:${c.reset} ${compSummary.summary.approved}`);
      console.log(`${c.red}Rejected:${c.reset} ${compSummary.summary.rejected}`);
      console.log(`${c.yellow}Skipped:${c.reset} ${compSummary.summary.skipped}`);
      console.log(`${c.dim}Pending:${c.reset} ${compSummary.summary.pending}`);

      if (compSummary.approved.length > 0) {
        console.log(`\n${c.green}Approved Stories:${c.reset}`);
        for (const s of compSummary.approved) {
          console.log(`  - ${s.title}`);
        }
      }

      if (compSummary.rejected.length > 0) {
        console.log(`\n${c.red}Rejected Stories:${c.reset}`);
        for (const s of compSummary.rejected) {
          console.log(`  - ${s.title}: "${s.reason}"`);
        }
      }

      if (compSummary.skipped.length > 0) {
        console.log(`\n${c.yellow}Skipped Stories:${c.reset}`);
        for (const s of compSummary.skipped) {
          console.log(`  - ${s.title}`);
        }
      }
      break;

    // E3-S4: Edit and Change Handling Commands
    case 'edit-story':
      // Start editing a story
      const editStoryId = args[1];
      if (!editStoryId) {
        console.error(`${c.red}Error: Story ID required. Usage: edit-story <story-id>${c.reset}`);
        process.exit(1);
      }

      const editResult = startEditSession(editStoryId);

      if (editResult.error) {
        console.error(`${c.red}Error: ${editResult.error}${c.reset}`);
        if (editResult.active_session) {
          console.log(`${c.dim}Active session: ${editResult.active_session.story_id}${c.reset}`);
        }
        process.exit(1);
      }

      console.log(`${c.green}✓ Edit session started${c.reset}`);
      console.log(`${c.cyan}Session ID:${c.reset} ${editResult.session.id}`);
      console.log(`${c.cyan}Story:${c.reset} ${editResult.story.title}`);

      if (editResult.rejection_reason) {
        console.log(`\n${c.yellow}Rejection reason:${c.reset} ${editResult.rejection_reason}`);
      }

      console.log(`\n${c.cyan}Editable sections:${c.reset}`);
      for (const section of editResult.editable_sections) {
        console.log(`  - ${section}`);
      }

      console.log(`\n${c.dim}Available commands:${c.reset}`);
      console.log(`  edit-user-story ${editStoryId} --action "manage users"`);
      console.log(`  edit-criterion ${editStoryId} AC-1 --then "new outcome"`);
      console.log(`  add-criterion ${editStoryId} --scenario "New scenario" ...`);
      console.log(`  remove-criterion ${editStoryId} AC-2`);
      console.log(`  edit-changes`);
      console.log(`  commit-edit`);
      console.log(`  cancel-edit`);
      break;

    case 'edit-user-story':
      // Edit user story fields
      const editUsStoryId = args[1];
      if (!editUsStoryId) {
        console.error(`${c.red}Error: Story ID required${c.reset}`);
        process.exit(1);
      }

      const usUpdates = {};
      for (let i = 2; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];
        if (flag === '--user-type') usUpdates.user_type = value;
        if (flag === '--action') usUpdates.action = value;
        if (flag === '--benefit') usUpdates.benefit = value;
      }

      if (Object.keys(usUpdates).length === 0) {
        console.error(`${c.red}Error: No updates specified. Use --user-type, --action, or --benefit${c.reset}`);
        process.exit(1);
      }

      const usEditResult = editUserStory(editUsStoryId, usUpdates);

      if (usEditResult.error) {
        console.error(`${c.red}Error: ${usEditResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ User story updated${c.reset}`);
      for (const change of usEditResult.changes) {
        console.log(`  ${c.dim}${change.field}:${c.reset} "${change.before}" → "${change.after}"`);
      }
      break;

    case 'edit-criterion':
      // Edit acceptance criterion
      const editCrStoryId = args[1];
      const editCrId = args[2];
      if (!editCrStoryId || !editCrId) {
        console.error(`${c.red}Error: Story ID and criterion ID required${c.reset}`);
        console.error(`${c.dim}Usage: edit-criterion <story-id> <criterion-id> [--scenario "..."] [--given "..."] [--when "..."] [--then "..."]${c.reset}`);
        process.exit(1);
      }

      const crUpdates = {};
      for (let i = 3; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];
        if (flag === '--scenario') crUpdates.scenario = value;
        if (flag === '--given') crUpdates.given = value;
        if (flag === '--when') crUpdates.when = value;
        if (flag === '--then') crUpdates.then = value;
      }

      if (Object.keys(crUpdates).length === 0) {
        console.error(`${c.red}Error: No updates specified. Use --scenario, --given, --when, or --then${c.reset}`);
        process.exit(1);
      }

      const crEditResult = editCriterion(editCrStoryId, editCrId, crUpdates);

      if (crEditResult.error) {
        console.error(`${c.red}Error: ${crEditResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Criterion ${editCrId} updated${c.reset}`);
      for (const change of crEditResult.changes) {
        console.log(`  ${c.dim}${change.field}:${c.reset} "${change.before}" → "${change.after}"`);
      }
      break;

    case 'add-criterion':
      // Add new acceptance criterion
      const addCrStoryId = args[1];
      if (!addCrStoryId) {
        console.error(`${c.red}Error: Story ID required${c.reset}`);
        console.error(`${c.dim}Usage: add-criterion <story-id> --scenario "..." --given "..." --when "..." --then "..."${c.reset}`);
        process.exit(1);
      }

      const newCriterion = {};
      for (let i = 2; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];
        if (flag === '--scenario') newCriterion.scenario = value;
        if (flag === '--given') newCriterion.given = value;
        if (flag === '--when') newCriterion.when = value;
        if (flag === '--then') newCriterion.then = value;
      }

      const addCrResult = addCriterion(addCrStoryId, newCriterion);

      if (addCrResult.error) {
        console.error(`${c.red}Error: ${addCrResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.green}✓ Added criterion ${addCrResult.criterion.id}${c.reset}`);
      console.log(`${c.dim}Scenario: ${addCrResult.criterion.scenario}${c.reset}`);
      break;

    case 'remove-criterion':
      // Remove acceptance criterion
      const rmCrStoryId = args[1];
      const rmCrId = args[2];
      if (!rmCrStoryId || !rmCrId) {
        console.error(`${c.red}Error: Story ID and criterion ID required${c.reset}`);
        console.error(`${c.dim}Usage: remove-criterion <story-id> <criterion-id>${c.reset}`);
        process.exit(1);
      }

      const rmReason = args.slice(3).join(' ') || 'Removed by user';
      const rmCrResult = removeCriterion(rmCrStoryId, rmCrId, rmReason);

      if (rmCrResult.error) {
        console.error(`${c.red}Error: ${rmCrResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.yellow}✓ Removed criterion ${rmCrId}${c.reset}`);
      console.log(`${c.dim}Scenario: ${rmCrResult.removed.scenario}${c.reset}`);
      break;

    case 'edit-changes':
      // Show changes in current edit session
      const changesResult = getEditChanges();

      if (changesResult.error) {
        console.error(`${c.red}Error: ${changesResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(changesResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Edit Session Changes${c.reset}\n`);
      console.log(`Session ID: ${changesResult.session_id}`);
      console.log(`Story: ${changesResult.story_id}`);
      console.log(`Started: ${changesResult.started_at}`);
      console.log(`Trigger: ${changesResult.trigger}`);
      if (changesResult.rejection_reason) {
        console.log(`Rejection reason: ${changesResult.rejection_reason}`);
      }

      if (changesResult.changes.length === 0) {
        console.log(`\n${c.dim}No changes made yet${c.reset}`);
      } else {
        console.log(`\n${c.cyan}Changes (${changesResult.changes_count}):${c.reset}`);
        for (const change of changesResult.changes) {
          console.log(`\n  ${c.dim}${change.id}${c.reset} [${change.type}]`);
          if (change.target) console.log(`    Target: ${change.target}`);
          if (change.field) console.log(`    Field: ${change.field}`);
          if (change.before !== null && change.before !== undefined) {
            const beforeStr = typeof change.before === 'object' ? JSON.stringify(change.before).slice(0, 50) : change.before;
            console.log(`    Before: "${beforeStr}"`);
          }
          if (change.after !== null && change.after !== undefined) {
            const afterStr = typeof change.after === 'object' ? JSON.stringify(change.after).slice(0, 50) : change.after;
            console.log(`    After: "${afterStr}"`);
          }
        }
      }
      break;

    case 'commit-edit':
      // Commit edit session
      const commitResult = commitEditSession();

      if (commitResult.error) {
        console.error(`${c.red}Error: ${commitResult.error}${c.reset}`);
        if (commitResult.errors) {
          console.log(`\n${c.red}Validation errors:${c.reset}`);
          for (const err of commitResult.errors) {
            console.log(`  ${c.red}✗${c.reset} ${err.field}: ${err.message}`);
          }
        }
        process.exit(1);
      }

      console.log(`${c.green}✓ Edit session committed${c.reset}`);
      console.log(`${c.cyan}Story:${c.reset} ${commitResult.story_id}`);
      console.log(`${c.cyan}Changes made:${c.reset} ${commitResult.changes_made}`);
      console.log(`${c.cyan}Status:${c.reset} ${commitResult.previous_status} → ${commitResult.new_status}`);

      if (commitResult.validation_warnings?.length > 0) {
        console.log(`\n${c.yellow}Warnings:${c.reset}`);
        for (const warn of commitResult.validation_warnings) {
          console.log(`  ${c.yellow}⚠${c.reset} ${warn.field}: ${warn.message}`);
        }
      }

      console.log(`\n${c.dim}Story returned to presentation queue. Run 'present' to review.${c.reset}`);
      break;

    case 'cancel-edit':
      // Cancel edit session
      const cancelResult = cancelEditSession();

      if (cancelResult.error) {
        console.error(`${c.red}Error: ${cancelResult.error}${c.reset}`);
        process.exit(1);
      }

      console.log(`${c.yellow}✓ Edit session cancelled${c.reset}`);
      console.log(`${c.dim}Discarded ${cancelResult.discarded_changes} change(s)${c.reset}`);
      break;

    case 'edit-history':
      // Show edit history for a story
      const histStoryId = args[1];
      if (!histStoryId) {
        console.error(`${c.red}Error: Story ID required. Usage: edit-history <story-id>${c.reset}`);
        process.exit(1);
      }

      const histResult = getEditHistory(histStoryId);

      if (histResult.error) {
        console.error(`${c.red}Error: ${histResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(histResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Edit History: ${histResult.title}${c.reset}\n`);
      console.log(`Story ID: ${histResult.story_id}`);
      console.log(`Total edits: ${histResult.edit_count}`);

      if (histResult.sessions.length === 0) {
        console.log(`\n${c.dim}No edit sessions recorded${c.reset}`);
      } else {
        console.log(`\n${c.cyan}Sessions:${c.reset}`);
        for (const sess of histResult.sessions) {
          const status = sess.cancelled ? `${c.red}cancelled${c.reset}` : `${c.green}committed${c.reset}`;
          console.log(`  ${sess.session_id} | ${sess.timestamp} | ${sess.trigger} | ${sess.changes_count} changes | ${status}`);
        }
      }
      break;

    case 'list-editable':
    case 'editable-stories':
      // List stories that can be edited
      const editableResult = listEditableStories();

      if (editableResult.error) {
        console.error(`${c.red}Error: ${editableResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(editableResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Editable Stories (${editableResult.total})${c.reset}\n`);

      if (editableResult.rejected.length > 0) {
        console.log(`${c.red}Rejected (${editableResult.rejected.length}):${c.reset}`);
        for (const s of editableResult.rejected) {
          console.log(`  ${s.id}: ${s.title}`);
          console.log(`    ${c.dim}Reason: ${s.rejection_reason}${c.reset}`);
        }
        console.log();
      }

      if (editableResult.approved.length > 0) {
        console.log(`${c.green}Approved (${editableResult.approved.length}):${c.reset}`);
        for (const s of editableResult.approved) {
          console.log(`  ${s.id}: ${s.title}`);
        }
        console.log();
      }

      if (editableResult.skipped.length > 0) {
        console.log(`${c.yellow}Skipped (${editableResult.skipped.length}):${c.reset}`);
        for (const s of editableResult.skipped) {
          console.log(`  ${s.id}: ${s.title}`);
        }
        console.log();
      }

      if (editableResult.total === 0) {
        console.log(`${c.dim}No editable stories. Run presentation first.${c.reset}`);
      }
      break;

    // ========================================================================
    // E3-S5: ready.json Integration Commands
    // ========================================================================

    case 'export-preview':
    case 'preview-export':
      // Preview what would be exported to ready.json
      const previewResult = previewExport();

      if (previewResult.error) {
        console.error(`${c.red}Error: ${previewResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(previewResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Export Preview${c.reset}\n`);
      console.log(`${c.green}Approved stories:${c.reset} ${previewResult.approved_count}`);
      console.log(`${c.yellow}Pending stories:${c.reset} ${previewResult.pending_count}`);
      console.log();

      if (previewResult.stories.length > 0) {
        console.log(`${c.cyan}Stories to export:${c.reset}`);
        for (const s of previewResult.stories) {
          console.log(`  ${s.id}: ${s.title}`);
          console.log(`    ${c.dim}Priority: ${s.priority} | Criteria: ${s.criteria_count} | Coverage: ${s.coverage}%${c.reset}`);
        }
        console.log();
      }

      if (previewResult.validation.warnings.length > 0) {
        console.log(`${c.yellow}Warnings:${c.reset}`);
        for (const w of previewResult.validation.warnings) {
          console.log(`  ${w.story_id}: ${w.message}`);
        }
        console.log();
      }

      if (previewResult.validation.errors.length > 0) {
        console.log(`${c.red}Errors:${c.reset}`);
        for (const e of previewResult.validation.errors) {
          console.log(`  ${e.story_id}: ${e.message}`);
        }
        console.log();
      }

      console.log(`${c.cyan}Ready to export:${c.reset} ${previewResult.ready_to_export ? `${c.green}Yes` : `${c.red}No`}${c.reset}`);
      if (previewResult.ready_to_export) {
        console.log(`\n${c.dim}Run 'flow transcript-digest finalize' to export to ready.json${c.reset}`);
      }
      break;

    case 'export-approved':
      // Export approved stories (dry run, no ready.json update)
      const exportApprovedResult = exportApprovedStories();

      if (exportApprovedResult.error) {
        console.error(`${c.red}Error: ${exportApprovedResult.error}${c.reset}`);
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(exportApprovedResult, null, 2));
        break;
      }

      console.log(`${c.cyan}Exported Stories (${exportApprovedResult.summary.exported})${c.reset}\n`);

      for (const task of exportApprovedResult.tasks) {
        console.log(`${c.green}${task.id}${c.reset}: ${task.title}`);
        console.log(`  ${c.dim}Priority: ${task.priority} | Criteria: ${task.metadata.criteria_count} | Coverage: ${task.metadata.coverage}%${c.reset}`);
      }

      if (exportApprovedResult.loadErrors.length > 0) {
        console.log(`\n${c.red}Failed to load:${c.reset}`);
        for (const e of exportApprovedResult.loadErrors) {
          console.log(`  ${e.id}: ${e.error}`);
        }
      }

      if (exportApprovedResult.validation.warnings.length > 0) {
        console.log(`\n${c.yellow}Warnings:${c.reset}`);
        for (const w of exportApprovedResult.validation.warnings) {
          console.log(`  ${w.story_id}: ${w.message}`);
        }
      }
      break;

    case 'finalize':
      // Finalize digestion and export to ready.json
      const finalizeOptions = {
        force: args.includes('--force'),
        exportFiles: args.includes('--export-files'),
        featureName: null
      };

      // Parse --feature option
      const featureIdx = args.indexOf('--feature');
      if (featureIdx !== -1 && args[featureIdx + 1]) {
        finalizeOptions.featureName = args[featureIdx + 1];
      }

      const finalizeResult = await finalizeDigestion(finalizeOptions);

      if (finalizeResult.error) {
        console.error(`${c.red}Error: ${finalizeResult.error}${c.reset}`);
        if (finalizeResult.pending) {
          console.error(`${c.dim}${finalizeResult.pending} stories still need review.${c.reset}`);
          console.error(`${c.dim}Use --force to proceed anyway.${c.reset}`);
        }
        process.exit(1);
      }

      if (args.includes('--json')) {
        console.log(JSON.stringify(finalizeResult, null, 2));
        break;
      }

      console.log(`${c.green}✓ Digestion Finalized${c.reset}\n`);
      console.log(`${c.cyan}Summary:${c.reset}`);
      console.log(`  Approved stories: ${finalizeResult.approved_count}`);
      console.log(`  Tasks added to ready.json: ${finalizeResult.tasks_added}`);
      console.log(`  Tasks skipped (duplicates): ${finalizeResult.tasks_skipped}`);
      if (finalizeResult.files_exported > 0) {
        console.log(`  Story files exported: ${finalizeResult.files_exported}`);
      }
      console.log(`  Digest status: ${c.green}${finalizeResult.digest_status}${c.reset}`);

      if (finalizeResult.validation?.warnings?.length > 0) {
        console.log(`\n${c.yellow}Warnings:${c.reset}`);
        for (const w of finalizeResult.validation.warnings) {
          console.log(`  ${w.story_id}: ${w.message}`);
        }
      }

      console.log(`\n${c.dim}Tasks are now available in .workflow/state/ready.json${c.reset}`);
      console.log(`${c.dim}Run '/wogi-ready' to see all available tasks${c.reset}`);
      break;

    // ============================================
    // Zero-Loss Extraction Commands
    // ============================================

    case 'extract-zero-loss':
    case 'zero-loss': {
      const subCommand = args[1];
      const zeroLossExtraction = require('./flow-zero-loss-extraction');
      const extractionReview = require('./flow-extraction-review');

      switch (subCommand) {
        case 'start': {
          // Start zero-loss extraction
          let textToExtract;
          if (!args[2] || args[2] === '-') {
            textToExtract = fs.readFileSync(0, 'utf8');
          } else {
            textToExtract = fs.readFileSync(args[2], 'utf8');
          }

          console.log(`${c.cyan}Starting zero-loss extraction...${c.reset}\n`);

          const extractionResult = zeroLossExtraction.extractZeroLoss(textToExtract);
          extractionReview.initializeReview(extractionResult);

          console.log(`${c.green}✓ Zero-loss extraction complete${c.reset}\n`);
          console.log(`${c.dim}Input:${c.reset} ${extractionResult.input.word_count} words, ${extractionResult.input.line_count} lines`);
          console.log(`${c.dim}Extracted:${c.reset} ${extractionResult.extraction.raw_statements} statements`);
          console.log(`${c.dim}After dedup:${c.reset} ${extractionResult.extraction.after_dedup} unique items`);
          console.log();
          console.log(`${c.cyan}Confidence breakdown:${c.reset}`);
          console.log(`  ${c.green}High:${c.reset} ${extractionResult.review.summary.high_confidence} items`);
          console.log(`  ${c.yellow}Medium:${c.reset} ${extractionResult.review.summary.medium_confidence} items`);
          console.log(`  ${c.dim}Low:${c.reset} ${extractionResult.review.summary.low_confidence} items`);
          console.log(`  ${c.dim}Filler:${c.reset} ${extractionResult.review.summary.potential_filler} items`);
          console.log();
          printWarn('REVIEW REQUIRED');
          console.log(`${c.dim}Nothing is filtered - all items captured for your review.${c.reset}`);
          console.log(`${c.dim}Use 'flow long-input zero-loss show pending' to see items.${c.reset}`);
          break;
        }

        case 'status':
          console.log(extractionReview.formatReviewStatus());
          break;

        case 'show': {
          const filter = args[2] || 'pending';
          const limit = parseInt(args[3]) || 10;
          console.log(extractionReview.formatItemsForReview(filter, limit));
          break;
        }

        case 'confirm': {
          if (!args[2]) {
            console.error(`${c.red}Usage: zero-loss confirm <item-id> [notes]${c.reset}`);
            process.exit(1);
          }
          extractionReview.confirmItem(args[2], args[3]);
          console.log(`${c.green}✓ Confirmed: ${args[2]}${c.reset}`);
          break;
        }

        case 'remove': {
          if (!args[2] || !args[3]) {
            console.error(`${c.red}Usage: zero-loss remove <item-id> <reason>${c.reset}`);
            console.error(`${c.dim}Reason is REQUIRED - nothing is silently filtered.${c.reset}`);
            process.exit(1);
          }
          extractionReview.removeItem(args[2], args.slice(3).join(' '));
          console.log(`${c.red}✗ Removed: ${args[2]}${c.reset}`);
          break;
        }

        case 'merge': {
          if (!args[2] || !args[3]) {
            console.error(`${c.red}Usage: zero-loss merge <source-id> <target-id>${c.reset}`);
            process.exit(1);
          }
          extractionReview.mergeItems(args[2], args[3]);
          console.log(`${c.blue}⊕ Merged: ${args[2]} → ${args[3]}${c.reset}`);
          break;
        }

        case 'confirm-high':
          extractionReview.confirmAllHighConfidence();
          console.log(`${c.green}✓ All high-confidence items confirmed${c.reset}`);
          console.log(extractionReview.formatReviewStatus());
          break;

        case 'dismiss-filler':
          extractionReview.dismissFiller();
          console.log(`${c.yellow}✓ Filler items dismissed${c.reset}`);
          console.log(extractionReview.formatReviewStatus());
          break;

        case 'complete': {
          const completeResult = extractionReview.confirmCompleteness();
          if (completeResult.success) {
            console.log(`${c.green}✓ Review complete!${c.reset}`);
            console.log(`  Confirmed tasks: ${completeResult.summary.confirmed_tasks}`);
            console.log(`  Removed items: ${completeResult.summary.removed_items}`);
            console.log(`  Merged items: ${completeResult.summary.merged_items}`);
            console.log();
            console.log(`${c.dim}Confirmed tasks are ready for topic extraction.${c.reset}`);
            console.log(`${c.dim}Run 'flow long-input topics' to continue.${c.reset}`);
          } else {
            console.error(`${c.red}✗ ${completeResult.error}${c.reset}`);
            if (completeResult.pending_items) {
              console.error(`\n${c.yellow}Pending items:${c.reset}`);
              for (const item of completeResult.pending_items) {
                console.error(`  ${item.id}: "${item.text}..."`);
              }
            }
          }
          break;
        }

        case 'tasks': {
          try {
            const tasks = extractionReview.getConfirmedTasks();
            if (args.includes('--json')) {
              console.log(JSON.stringify(tasks, null, 2));
            } else {
              console.log(`${c.green}${tasks.length} confirmed tasks:${c.reset}\n`);
              for (const task of tasks) {
                console.log(`${c.cyan}[${task.id}]${c.reset} ${task.text}`);
                if (task.user_notes) {
                  console.log(`  ${c.dim}Note: ${task.user_notes}${c.reset}`);
                }
              }
            }
          } catch (err) {
            console.error(`${c.red}✗ ${err.message}${c.reset}`);
          }
          break;
        }

        default:
          console.log(`
${c.cyan}Zero-Loss Extraction${c.reset}

${c.bold}100% task capture rate - nothing is auto-filtered.${c.reset}

${c.dim}Commands:${c.reset}
  start <file|->              Extract from file or stdin
  status                      Show review progress
  show <filter> [limit]       Show items (pending|confirmed|removed|high|medium|low|filler)
  confirm <id> [notes]        Confirm item as a task
  remove <id> <reason>        Remove item (reason REQUIRED)
  merge <src-id> <tgt-id>     Merge item into another
  confirm-high                Bulk confirm all high-confidence items
  dismiss-filler              Bulk dismiss filler items
  complete                    Confirm review is complete (MANDATORY before proceeding)
  tasks [--json]              Get confirmed tasks

${c.dim}Workflow:${c.reset}
  1. Start extraction:  flow long-input zero-loss start < transcript.txt
  2. Quick confirm:     flow long-input zero-loss confirm-high
  3. Review medium:     flow long-input zero-loss show medium
  4. Review low:        flow long-input zero-loss show low
  5. Dismiss filler:    flow long-input zero-loss dismiss-filler
  6. Complete review:   flow long-input zero-loss complete
  7. Continue:          flow long-input topics

${c.yellow}⚠ User must explicitly confirm the task list is complete before proceeding.${c.reset}
`);
      }
      break;
    }

    case 'help':
    default:
      console.log(`
${c.cyan}Transcript Digestion CLI${c.reset}

${c.dim}Core Commands:${c.reset}
  status              Show current digest session status
  new <file|->        Create new digest session from file or stdin
  check <file|-> [--json]  Check if text should trigger digestion (enhanced)
  analyze <file|-> [--json]  Detailed input analysis (metrics, format, thresholds)
  classify <file|-> [--json] [-v]  Classify content type (transcript, requirements, etc.)
  recommend <file|-> [--json]  Get processing recommendation

${c.dim}Subtitle Parsing (E4-S3):${c.reset}
  parse-vtt <file|->        Parse VTT subtitle file to text
  parse-srt <file|->        Parse SRT subtitle file to text
  parse-subtitle <file|->   Auto-detect and parse VTT/SRT file
    Options: --json (cue data), --stats (statistics)
             --timestamps/-t, --speakers/-s, --no-merge

${c.dim}Meeting Parsing (E4-S4):${c.reset}
  parse-zoom <file|->       Parse Zoom transcript (chat or VTT)
  parse-teams <file|->      Parse Teams transcript (chat, VTT, or JSON)
  parse-meeting <file|->    Auto-detect Zoom/Teams format
    Options: --json, --stats, --timestamps/-t, --no-merge
             --include-system (include join/leave messages)
             --format <chat|vtt|json> (force format)

${c.dim}Language Detection (E5-S1):${c.reset}
  detect-language <file|->  Detect primary language of content
  detect-languages <file|-> Detect multiple languages in mixed content
  language-info [code]      Get info about a language or list all supported
    Options: --json, -v/--verbose, --segment-size <n>

${c.dim}Multi-language Clarification (E5-S2):${c.reset}
  set-language <code>       Set preferred language for questions
  show-language             Show current session language settings
  detect-session-language   Detect and store language for active session
    Options: --json

${c.dim}Durable Sessions (E5-S3):${c.reset}
  sessions                  List all digest sessions
  session-info <id>         Show details for a specific session
  switch-session <id>       Switch to a different session
  session-recovery [id]     Show recovery summary and next steps
  archive-session <id>      Archive a session
  delete-session <id>       Delete a session
    Options: --json, --status=<active|completed|archived>
             --delete-files (for delete-session)

${c.dim}Large Transcript Chunking (E5-S4):${c.reset}
  needs-chunking <file|->   Check if transcript needs chunking
  plan-chunks <file|->      Plan how to chunk a large transcript
  chunk-status              Show current chunking status
    Options: --json, --target-words <n> (for plan-chunks)

${c.dim}Pass Commands:${c.reset}
  topics              Show extracted topics
  save-topics         Save topics from stdin (JSON)
  pass2 | statements  Run Pass 2: Statement Association
  statement-map       Show full statement map (JSON)
  orphans             Show orphan statements needing clarification
  contradictions      Show detected contradictions
  pass3               Run Pass 3: Orphan Check (resolve orphans)
  pass4               Run Pass 4: Contradiction Resolution
  coverage            Show coverage summary

${c.dim}Question Commands:${c.reset}
  questions           Generate clarifying questions
  show-questions      Show pending questions grouped by topic
  clarifications      Show pending clarification questions

${c.dim}Conversation Commands (E2-S2):${c.reset}
  answer [--voice] "<response>"  Process natural language answer
  capture-answer <id> <ans>   Manually capture answer for question
  next-questions [n] [topic]  Get next batch of questions (default: 5)
  completion-status           Check if all clarifications complete
  resolve-contradiction <id> <choice>  Resolve contradiction

${c.dim}Voice Commands (E2-S3):${c.reset}
  voice-normalize "<text>"    Test voice normalization (no session needed)

${c.dim}Persistence Commands (E2-S4):${c.reset}
  resume                      Resume an interrupted session
  review                      Review all answered questions
  history                     Show session interaction history
  export [--format json|md]   Export session state for backup

${c.dim}Complexity Commands (E3-S1):${c.reset}
  complexity [--json]         Analyze complexity and recommend output structure

${c.dim}Story Commands (E3-S2):${c.reset}
  generate-story <topic> [--json|--md]  Generate story for a topic
  generate-stories [--json]    Generate stories for all topics
  show-story <id> [--json]     Show a specific story
  list-stories [--json]        List all generated stories
  validate-stories [--json]    Validate story coverage

${c.dim}Presentation Commands (E3-S3):${c.reset}
  present                       Start/continue story presentation
  approve                       Approve current story and advance
  reject "<reason>"             Reject current story with reason
  skip                          Skip current story for later
  view-current                  View full current story
  presentation-status           Show presentation progress
  reset-presentation            Reset presentation to start over
  completion-summary [--json]   Show approval/rejection summary

${c.dim}Edit Commands (E3-S4):${c.reset}
  edit-story <id>               Start editing a story
  edit-user-story <id> [opts]   Edit user story (--user-type, --action, --benefit)
  edit-criterion <id> <ac> [opts]  Edit criterion (--scenario, --given, --when, --then)
  add-criterion <id> [opts]     Add new criterion
  remove-criterion <id> <ac>    Remove criterion
  edit-changes [--json]         Show changes in current session
  commit-edit                   Commit edits, return to queue
  cancel-edit                   Discard edits
  edit-history <id> [--json]    Show edit history for story
  list-editable [--json]        List editable stories

${c.dim}Export Commands (E3-S5):${c.reset}
  export-preview [--json]       Preview what would be exported to ready.json
  export-approved [--json]      Export approved stories (dry run)
  finalize [options]            Finalize and export to ready.json
                                --force: Proceed with pending stories
                                --export-files: Also export .md files
                                --feature <name>: Group under feature name

${c.dim}Examples:${c.reset}
  flow transcript-digest status
  flow transcript-digest new transcript.txt
  cat transcript.txt | flow transcript-digest new -
  flow transcript-digest check large-input.txt
  flow transcript-digest pass2
  flow transcript-digest pass3
  flow transcript-digest pass4
  flow transcript-digest questions
  flow transcript-digest show-questions
  flow transcript-digest answer "Name, email, and role columns"
  flow transcript-digest answer --voice "um so like name and uh email I guess"
  flow transcript-digest voice-normalize "um so like three columns actually wait four columns"
  flow transcript-digest completion-status
  flow transcript-digest resume
  flow transcript-digest review
  flow transcript-digest export --format md
  flow transcript-digest complexity
  flow transcript-digest complexity --json
  flow transcript-digest generate-stories
  flow transcript-digest show-story story-abc123 --md
  flow transcript-digest present
  flow transcript-digest approve
  flow transcript-digest reject "Need more detail on validation"
  flow transcript-digest skip
  flow transcript-digest presentation-status
  flow transcript-digest list-editable
  flow transcript-digest edit-story story-abc123
  flow transcript-digest edit-user-story story-abc123 --action "manage user accounts"
  flow transcript-digest edit-criterion story-abc123 AC-1 --then "table should be sortable"
  flow transcript-digest add-criterion story-abc123 --scenario "Sort users" --given "viewing table" --when "click column" --then "sorted"
  flow transcript-digest edit-changes
  flow transcript-digest commit-edit
  flow transcript-digest export-preview
  flow transcript-digest export-approved --json
  flow transcript-digest finalize
  flow transcript-digest finalize --force
  flow transcript-digest finalize --export-files --feature user-management
`);
  }
}

module.exports = { main };
