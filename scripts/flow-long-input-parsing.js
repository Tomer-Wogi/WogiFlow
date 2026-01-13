#!/usr/bin/env node

/**
 * Wogi Flow - Transcript Parsing Module
 *
 * Parses various subtitle and meeting formats:
 * - VTT (WebVTT) format
 * - SRT (SubRip) format
 * - Zoom chat and VTT exports
 * - Microsoft Teams chat, VTT, and JSON exports
 *
 * Extracted from flow-transcript-digest.js for modularity.
 */

// ==========================================================================
// E4-S3: VTT/SRT Format Parsing Functions
// ==========================================================================

/**
 * VTT timestamp patterns
 */
const VTT_TIMESTAMP_FULL = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
const VTT_TIMESTAMP_SHORT = /(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})/;
const VTT_VOICE_TAG = /<v\s+([^>]+)>/;

/**
 * SRT timestamp pattern
 */
const SRT_TIMESTAMP = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

/**
 * Common speaker patterns
 */
const SPEAKER_COLON_PATTERN = /^([A-Z][a-zA-Z\s]+):\s*/;
const SPEAKER_BRACKET_PATTERN = /^\[([^\]]+)\]\s*/;

/**
 * Simple word counter utility
 */
function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Detect VTT format
 */
function isVTTFormat(text) {
  // Check for WEBVTT header
  if (text.trim().startsWith('WEBVTT')) {
    return { detected: true, confidence: 0.95 };
  }
  // Check for VTT timestamps
  const timestamps = text.match(VTT_TIMESTAMP_FULL) || text.match(VTT_TIMESTAMP_SHORT);
  if (timestamps) {
    return { detected: true, confidence: 0.85 };
  }
  return { detected: false, confidence: 0 };
}

/**
 * Detect SRT format
 */
function isSRTFormat(text) {
  const timestamps = text.match(SRT_TIMESTAMP);
  const cueNumbers = text.match(/^\d+\s*$/m);
  if (timestamps && cueNumbers) {
    return { detected: true, confidence: 0.9 };
  }
  return { detected: false, confidence: 0 };
}

/**
 * Convert timestamp to milliseconds
 */
function timestampToMs(hours, minutes, seconds, ms) {
  return (parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)) * 1000 + parseInt(ms);
}

/**
 * Format milliseconds as timestamp string
 */
function msToTimestamp(ms, short = false) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  if (short && hours === 0) {
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Clean VTT/SRT text by removing HTML tags and entities
 */
function cleanSubtitleText(text) {
  let cleaned = text
    // Remove HTML tags
    .replace(/<\/?[biuc][^>]*>/gi, '')
    .replace(/<\/?v[^>]*>/gi, '')
    .replace(/<\/?lang[^>]*>/gi, '')
    .replace(/<\/?ruby>/gi, '')
    .replace(/<\/?rt>/gi, '')
    // Decode entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

/**
 * Extract speaker from VTT voice tag
 */
function extractVTTSpeaker(line) {
  const voiceMatch = line.match(VTT_VOICE_TAG);
  if (voiceMatch) {
    const speaker = voiceMatch[1].trim();
    const text = line.replace(VTT_VOICE_TAG, '').trim();
    return { speaker, text };
  }
  return { speaker: null, text: line };
}

/**
 * Extract speaker from common patterns
 */
function extractSpeaker(text) {
  // Check colon pattern: "Speaker Name: text"
  const colonMatch = text.match(SPEAKER_COLON_PATTERN);
  if (colonMatch) {
    return {
      speaker: colonMatch[1].trim(),
      text: text.substring(colonMatch[0].length).trim()
    };
  }

  // Check bracket pattern: "[Speaker Name] text"
  const bracketMatch = text.match(SPEAKER_BRACKET_PATTERN);
  if (bracketMatch) {
    return {
      speaker: bracketMatch[1].trim(),
      text: text.substring(bracketMatch[0].length).trim()
    };
  }

  return { speaker: null, text };
}

/**
 * Parse VTT file content
 * @param {string} content - VTT file content
 * @returns {{ metadata: object, cues: array, format: string, error?: string, partial?: boolean }}
 */
function parseVTT(content) {
  // Input validation
  if (!content || typeof content !== 'string') {
    return { metadata: {}, cues: [], format: 'vtt', error: 'Invalid input: content must be a non-empty string' };
  }

  const lines = content.split('\n');
  const cues = [];
  let metadata = {};
  let currentCue = null;
  let inCue = false;
  let cueIndex = 0;
  let parseErrors = [];

  try {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip WEBVTT header
    if (line.startsWith('WEBVTT')) {
      continue;
    }

    // Parse metadata (Kind, Language, etc.)
    if (line.includes(':') && !inCue && !line.match(VTT_TIMESTAMP_FULL) && !line.match(VTT_TIMESTAMP_SHORT)) {
      const [key, ...valueParts] = line.split(':');
      if (key.match(/^[A-Za-z]+$/)) {
        metadata[key.trim().toLowerCase()] = valueParts.join(':').trim();
        continue;
      }
    }

    // Skip NOTE comments
    if (line.startsWith('NOTE')) {
      // Skip until empty line
      while (i < lines.length && lines[i].trim() !== '') {
        i++;
      }
      continue;
    }

    // Skip empty lines
    if (line === '') {
      if (currentCue && currentCue.textLines.length > 0) {
        cues.push(finalizeCue(currentCue));
        currentCue = null;
        inCue = false;
      }
      continue;
    }

    // Check for timestamp line
    const fullMatch = line.match(VTT_TIMESTAMP_FULL);
    const shortMatch = line.match(VTT_TIMESTAMP_SHORT);

    if (fullMatch || shortMatch) {
      if (currentCue && currentCue.textLines.length > 0) {
        cues.push(finalizeCue(currentCue));
      }

      cueIndex++;
      if (fullMatch) {
        currentCue = {
          index: cueIndex,
          startMs: timestampToMs(fullMatch[1], fullMatch[2], fullMatch[3], fullMatch[4]),
          endMs: timestampToMs(fullMatch[5], fullMatch[6], fullMatch[7], fullMatch[8]),
          settings: line.substring(fullMatch[0].length).trim(),
          textLines: [],
          rawLines: []
        };
      } else {
        currentCue = {
          index: cueIndex,
          startMs: timestampToMs(0, shortMatch[1], shortMatch[2], shortMatch[3]),
          endMs: timestampToMs(0, shortMatch[4], shortMatch[5], shortMatch[6]),
          settings: line.substring(shortMatch[0].length).trim(),
          textLines: [],
          rawLines: []
        };
      }
      inCue = true;
      continue;
    }

    // Text content
    if (inCue && currentCue) {
      currentCue.rawLines.push(line);
      const { speaker, text } = extractVTTSpeaker(line);
      if (speaker && !currentCue.speaker) {
        currentCue.speaker = speaker;
      }
      currentCue.textLines.push(cleanSubtitleText(text));
    }
  }

  // Don't forget last cue
  if (currentCue && currentCue.textLines.length > 0) {
    cues.push(finalizeCue(currentCue));
  }

  // Return results with any parse errors noted
  const result = { metadata, cues, format: 'vtt' };
  if (parseErrors.length > 0) {
    result.parseErrors = parseErrors;
    result.partial = true;
  }
  return result;

  } catch (err) {
    // Return partial results on error
    return {
      metadata,
      cues,
      format: 'vtt',
      error: `Parse error: ${err.message}`,
      partial: cues.length > 0
    };
  }
}

/**
 * Parse SRT file content
 * @param {string} content - SRT file content
 * @returns {{ metadata: object, cues: array, format: string, error?: string, partial?: boolean }}
 */
function parseSRT(content) {
  // Input validation
  if (!content || typeof content !== 'string') {
    return { metadata: {}, cues: [], format: 'srt', error: 'Invalid input: content must be a non-empty string' };
  }

  const lines = content.split('\n');
  const cues = [];
  let currentCue = null;
  let _expectingTimestamp = false;

  try {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (line === '') {
      if (currentCue && currentCue.textLines.length > 0) {
        cues.push(finalizeCue(currentCue));
        currentCue = null;
        _expectingTimestamp = false;
      }
      continue;
    }

    // Check for cue number
    if (/^\d+$/.test(line) && !currentCue) {
      _expectingTimestamp = true;
      continue;
    }

    // Check for timestamp
    const timestampMatch = line.match(SRT_TIMESTAMP);
    if (timestampMatch) {
      if (currentCue && currentCue.textLines.length > 0) {
        cues.push(finalizeCue(currentCue));
      }

      currentCue = {
        index: cues.length + 1,
        startMs: timestampToMs(timestampMatch[1], timestampMatch[2], timestampMatch[3], timestampMatch[4]),
        endMs: timestampToMs(timestampMatch[5], timestampMatch[6], timestampMatch[7], timestampMatch[8]),
        settings: '',
        textLines: [],
        rawLines: []
      };
      _expectingTimestamp = false;
      continue;
    }

    // Text content
    if (currentCue) {
      currentCue.rawLines.push(line);
      const cleaned = cleanSubtitleText(line);
      const { speaker, text } = extractSpeaker(cleaned);
      if (speaker && !currentCue.speaker) {
        currentCue.speaker = speaker;
      }
      currentCue.textLines.push(text);
    }
  }

  // Don't forget last cue
  if (currentCue && currentCue.textLines.length > 0) {
    cues.push(finalizeCue(currentCue));
  }

  return { metadata: {}, cues, format: 'srt' };

  } catch (err) {
    // Return partial results on error
    return {
      metadata: {},
      cues,
      format: 'srt',
      error: `Parse error: ${err.message}`,
      partial: cues.length > 0
    };
  }
}

/**
 * Finalize a cue with computed properties
 */
function finalizeCue(cue) {
  return {
    index: cue.index,
    startTime: msToTimestamp(cue.startMs),
    endTime: msToTimestamp(cue.endMs),
    startMs: cue.startMs,
    endMs: cue.endMs,
    duration: cue.endMs - cue.startMs,
    speaker: cue.speaker || null,
    text: cue.textLines.join(' ').trim(),
    rawText: cue.rawLines.join('\n'),
    settings: cue.settings || ''
  };
}

/**
 * Merge consecutive cues from the same speaker
 */
function mergeCues(cues, options = {}) {
  const mergeThreshold = options.mergeThreshold || 2000; // 2 seconds default
  const merged = [];
  let current = null;

  for (const cue of cues) {
    if (current === null) {
      current = {
        ...cue,
        textParts: [cue.text],
        cueCount: 1
      };
      continue;
    }

    const gap = cue.startMs - current.endMs;
    const sameSpeaker = cue.speaker === current.speaker;

    if (sameSpeaker && gap < mergeThreshold) {
      current.textParts.push(cue.text);
      current.endMs = cue.endMs;
      current.endTime = cue.endTime;
      current.duration = current.endMs - current.startMs;
      current.cueCount++;
    } else {
      current.text = current.textParts.join(' ');
      delete current.textParts;
      merged.push(current);
      current = {
        ...cue,
        textParts: [cue.text],
        cueCount: 1
      };
    }
  }

  if (current) {
    current.text = current.textParts.join(' ');
    delete current.textParts;
    merged.push(current);
  }

  return merged;
}

/**
 * Auto-detect and parse subtitle file
 */
function parseSubtitle(content) {
  // Check for VTT
  if (content.trim().startsWith('WEBVTT') || isVTTFormat(content).detected) {
    return parseVTT(content);
  }

  // Check for SRT
  if (isSRTFormat(content).detected) {
    return parseSRT(content);
  }

  return { error: 'Unable to detect subtitle format', format: 'unknown' };
}

/**
 * Format parsed cues as plain text
 */
function formatCuesAsText(cues, options = {}) {
  const lines = [];

  for (const cue of cues) {
    let line = '';

    if (options.timestamps || options.withTimestamps) {
      line += `[${msToTimestamp(cue.startMs, true)}] `;
    }

    if ((options.speakers || options.withSpeakers) && cue.speaker) {
      line += `${cue.speaker}: `;
    }

    line += cue.text;
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Get subtitle statistics
 */
function getSubtitleStats(parsed) {
  if (parsed.error) return null;

  const cues = parsed.cues;
  const speakers = new Set(cues.filter(c => c.speaker).map(c => c.speaker));
  const totalDuration = cues.length > 0 ? cues[cues.length - 1].endMs : 0;
  const totalWords = cues.reduce((sum, c) => sum + countWords(c.text), 0);

  return {
    format: parsed.format,
    cueCount: cues.length,
    speakerCount: speakers.size,
    speakers: Array.from(speakers),
    totalDurationMs: totalDuration,
    totalDuration: msToTimestamp(totalDuration),
    totalWords,
    avgWordsPerCue: cues.length > 0 ? Math.round(totalWords / cues.length * 10) / 10 : 0
  };
}

// ==========================================================================
// E4-S4: Zoom/Teams Export Parsing Functions
// ==========================================================================

/**
 * Pattern definitions for Zoom formats
 */
const ZOOM_PATTERNS = {
  // Chat format: "00:00:01	From John Smith to Everyone:"
  chatHeader: /^(\d{1,2}:\d{2}:\d{2})\t+From\s+(.+?)\s+to\s+(.+?):$/,
  // VTT with speaker: "John Smith: text"
  vttSpeaker: /^([A-Z][a-zA-Z\s'-]+):\s*(.+)$/,
  // Timestamp line in chat
  timestampLine: /^(\d{1,2}:\d{2}:\d{2})\t/,
  // System message (participant joined/left)
  systemMessage: /^(.+?)\s+(joined|left)\s+the\s+meeting\.?$/i,
  // Recording messages
  recordingMessage: /^Recording\s+(started|stopped)\.?$/i
};

/**
 * Pattern definitions for Teams formats
 */
const TEAMS_PATTERNS = {
  // Chat format: "[1/10/2026, 9:00:15 AM] John Smith: message"
  chatLine: /^\[(\d{1,2}\/\d{1,2}\/\d{4}),?\s*(\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)\]\s*([^:]+):\s*(.*)$/i,
  // Alternative chat format without date
  chatLineNoDate: /^\[(\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)\]\s*([^:]+):\s*(.*)$/i,
  // System event (joined/left)
  systemEvent: /^(.+?)\s+(joined|left)\s+the\s+meeting\.?$/i,
  // Reaction
  reaction: /^\[.+\]\s*(.+?)\s+reacted\s+/i,
  // Screen sharing
  screenShare: /^\[.+\]\s*(.+?)\s+(started|stopped)\s+sharing/i
};

/**
 * Check if text is a system message (joins/leaves/etc)
 */
function isSystemMessage(text) {
  if (!text) return false;
  const trimmed = text.trim();
  return (
    ZOOM_PATTERNS.systemMessage.test(trimmed) ||
    ZOOM_PATTERNS.recordingMessage.test(trimmed) ||
    TEAMS_PATTERNS.systemEvent.test(trimmed) ||
    TEAMS_PATTERNS.reaction.test(trimmed) ||
    TEAMS_PATTERNS.screenShare.test(trimmed)
  );
}

/**
 * Parse time string to milliseconds
 * Supports: "HH:MM:SS", "H:MM:SS", "9:00:15 AM"
 */
function parseTimeToMs(timeStr) {
  if (!timeStr) return 0;

  // Handle AM/PM format
  const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const seconds = parseInt(ampmMatch[3], 10);
    const ampm = ampmMatch[4];

    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }

    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  // Handle simple HH:MM:SS
  const simpleMatch = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (simpleMatch) {
    const hours = parseInt(simpleMatch[1], 10);
    const minutes = parseInt(simpleMatch[2], 10);
    const seconds = parseInt(simpleMatch[3], 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  return 0;
}

/**
 * Parse Zoom chat format
 */
function parseZoomChat(content, options = {}) {
  const lines = content.split('\n');
  const entries = [];
  let currentEntry = null;
  const includeSystem = options.includeSystem || false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for chat header: "00:00:01	From John Smith to Everyone:"
    const headerMatch = line.match(ZOOM_PATTERNS.chatHeader);
    if (headerMatch) {
      // Save previous entry
      if (currentEntry && currentEntry.text.trim()) {
        if (includeSystem || !isSystemMessage(currentEntry.text)) {
          entries.push(currentEntry);
        }
      }

      currentEntry = {
        index: entries.length + 1,
        timestamp: headerMatch[1],
        timestampMs: parseTimeToMs(headerMatch[1]),
        speaker: headerMatch[2].trim(),
        recipient: headerMatch[3].trim(),
        text: '',
        type: 'message',
        source: 'zoom_chat'
      };
      continue;
    }

    // Check for continuation line (starts with tab)
    if (currentEntry && line.startsWith('\t')) {
      const text = line.replace(/^\t+/, '').trim();
      if (text) {
        currentEntry.text += (currentEntry.text ? ' ' : '') + text;
      }
      continue;
    }

    // Check for line that starts with timestamp but no "From"
    if (line.match(ZOOM_PATTERNS.timestampLine) && !line.includes('From')) {
      // Might be a different format or continuation
      continue;
    }
  }

  // Don't forget last entry
  if (currentEntry && currentEntry.text.trim()) {
    if (includeSystem || !isSystemMessage(currentEntry.text)) {
      entries.push(currentEntry);
    }
  }

  return {
    format: 'zoom_chat',
    metadata: {
      entryCount: entries.length,
      participants: [...new Set(entries.map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Parse Zoom VTT transcript (VTT with speaker names in text)
 */
function parseZoomVTT(content, options = {}) {
  // First parse as standard VTT
  const vttResult = parseVTT(content);
  const includeSystem = options.includeSystem || false;

  // Then extract speakers from text if not already identified
  const entries = [];
  for (const cue of vttResult.cues) {
    let speaker = cue.speaker;
    let text = cue.text;

    // Try to extract speaker from "Name: text" pattern
    if (!speaker) {
      const speakerMatch = text.match(ZOOM_PATTERNS.vttSpeaker);
      if (speakerMatch) {
        speaker = speakerMatch[1].trim();
        text = speakerMatch[2].trim();
      }
    }

    // Skip system messages unless requested
    if (!includeSystem && isSystemMessage(text)) {
      continue;
    }

    entries.push({
      index: entries.length + 1,
      timestamp: cue.startTime,
      timestampMs: cue.startMs,
      endTimestampMs: cue.endMs,
      speaker: speaker,
      text: text,
      type: 'message',
      source: 'zoom_vtt'
    });
  }

  return {
    format: 'zoom_vtt',
    metadata: {
      ...vttResult.metadata,
      entryCount: entries.length,
      participants: [...new Set(entries.filter(e => e.speaker).map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Parse Teams chat format
 */
function parseTeamsChat(content, options = {}) {
  const lines = content.split('\n');
  const entries = [];
  const includeSystem = options.includeSystem || false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try full format with date: "[1/10/2026, 9:00:15 AM] John Smith: message"
    let match = trimmed.match(TEAMS_PATTERNS.chatLine);
    if (match) {
      const text = match[4].trim();

      // Skip system messages unless requested
      if (!includeSystem && isSystemMessage(text)) {
        continue;
      }

      // Skip reactions
      if (!includeSystem && TEAMS_PATTERNS.reaction.test(trimmed)) {
        continue;
      }

      entries.push({
        index: entries.length + 1,
        date: match[1],
        timestamp: match[2].trim(),
        timestampMs: parseTimeToMs(match[2].trim()),
        speaker: match[3].trim(),
        text: text,
        type: 'message',
        source: 'teams_chat'
      });
      continue;
    }

    // Try format without date: "[9:00:15 AM] John Smith: message"
    match = trimmed.match(TEAMS_PATTERNS.chatLineNoDate);
    if (match) {
      const text = match[3].trim();

      if (!includeSystem && isSystemMessage(text)) {
        continue;
      }

      entries.push({
        index: entries.length + 1,
        timestamp: match[1].trim(),
        timestampMs: parseTimeToMs(match[1].trim()),
        speaker: match[2].trim(),
        text: text,
        type: 'message',
        source: 'teams_chat'
      });
    }
  }

  return {
    format: 'teams_chat',
    metadata: {
      entryCount: entries.length,
      participants: [...new Set(entries.map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Parse Teams VTT transcript (VTT with voice tags)
 */
function parseTeamsVTT(content, options = {}) {
  // Parse as standard VTT - it already handles <v Speaker> tags
  const vttResult = parseVTT(content);
  const includeSystem = options.includeSystem || false;

  const entries = [];
  for (const cue of vttResult.cues) {
    // Skip system messages unless requested
    if (!includeSystem && isSystemMessage(cue.text)) {
      continue;
    }

    entries.push({
      index: entries.length + 1,
      timestamp: cue.startTime,
      timestampMs: cue.startMs,
      endTimestampMs: cue.endMs,
      speaker: cue.speaker,
      text: cue.text,
      type: 'message',
      source: 'teams_vtt'
    });
  }

  return {
    format: 'teams_vtt',
    metadata: {
      ...vttResult.metadata,
      entryCount: entries.length,
      participants: [...new Set(entries.filter(e => e.speaker).map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Parse Teams JSON transcript export
 */
function parseTeamsJSON(content, options = {}) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (_err) {
    return { error: 'Invalid JSON format', format: 'unknown' };
  }

  const includeSystem = options.includeSystem || false;

  // Handle different JSON structures
  let transcripts = data.transcripts || data.messages || data.entries || data;
  if (!Array.isArray(transcripts)) {
    return { error: 'No transcript array found in JSON', format: 'unknown' };
  }

  const entries = [];
  for (const item of transcripts) {
    const speaker = item.speakerName || item.speaker || item.from || item.author;
    const text = item.text || item.content || item.message || '';
    const timestamp = item.timestamp || item.time || item.createdDateTime;

    if (!includeSystem && isSystemMessage(text)) {
      continue;
    }

    entries.push({
      index: entries.length + 1,
      timestamp: timestamp,
      timestampMs: timestamp ? new Date(timestamp).getTime() : 0,
      speaker: speaker,
      text: text.trim(),
      type: 'message',
      source: 'teams_json'
    });
  }

  return {
    format: 'teams_json',
    metadata: {
      meetingId: data.meetingId,
      entryCount: entries.length,
      participants: [...new Set(entries.filter(e => e.speaker).map(e => e.speaker))]
    },
    entries
  };
}

/**
 * Detect meeting format from content
 */
function detectMeetingType(content) {
  const trimmed = content.trim();

  // Check for JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'teams_json';
    } catch (_err) {
      // Not valid JSON
    }
  }

  // Check for VTT format
  if (trimmed.startsWith('WEBVTT') || /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/.test(trimmed)) {
    // Check for voice tags (Teams style)
    if (/<v\s+[^>]+>/.test(trimmed)) {
      return 'teams_vtt';
    }
    // Check for speaker colon pattern (Zoom style)
    if (/\n[A-Z][a-zA-Z\s'-]+:\s/.test(trimmed)) {
      return 'zoom_vtt';
    }
    return 'generic_vtt';
  }

  // Check for Zoom chat format
  if (/^\d{1,2}:\d{2}:\d{2}\t+From\s+.+\s+to\s+.+:/m.test(trimmed)) {
    return 'zoom_chat';
  }

  // Check for Teams chat format
  if (/^\[\d{1,2}\/\d{1,2}\/\d{4},?\s*\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\]/im.test(trimmed)) {
    return 'teams_chat';
  }

  // Check for simple bracket timestamp format
  if (/^\[\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\]\s*[^:]+:/im.test(trimmed)) {
    return 'teams_chat';
  }

  return 'unknown';
}

/**
 * Parse Zoom transcript (auto-detect format)
 */
function parseZoom(content, options = {}) {
  const format = options.format || detectMeetingType(content);

  switch (format) {
    case 'zoom_chat':
      return parseZoomChat(content, options);
    case 'zoom_vtt':
    case 'generic_vtt':
      return parseZoomVTT(content, options);
    default:
      // Try VTT first
      if (content.includes('-->')) {
        return parseZoomVTT(content, options);
      }
      return parseZoomChat(content, options);
  }
}

/**
 * Parse Teams transcript (auto-detect format)
 */
function parseTeams(content, options = {}) {
  const format = options.format || detectMeetingType(content);

  switch (format) {
    case 'teams_json':
      return parseTeamsJSON(content, options);
    case 'teams_chat':
      return parseTeamsChat(content, options);
    case 'teams_vtt':
      return parseTeamsVTT(content, options);
    default:
      // Try to detect
      if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
        return parseTeamsJSON(content, options);
      }
      if (content.includes('-->')) {
        return parseTeamsVTT(content, options);
      }
      return parseTeamsChat(content, options);
  }
}

/**
 * Parse meeting transcript (auto-detect Zoom or Teams)
 */
function parseMeeting(content, options = {}) {
  const format = detectMeetingType(content);

  if (format.startsWith('zoom')) {
    return parseZoom(content, options);
  }

  if (format.startsWith('teams')) {
    return parseTeams(content, options);
  }

  if (format === 'generic_vtt') {
    // Try Zoom VTT parser as it handles generic VTT with speaker extraction
    return parseZoomVTT(content, options);
  }

  return { error: 'Unable to detect meeting format', format: 'unknown' };
}

/**
 * Merge consecutive entries from same speaker
 */
function mergeMeetingEntries(entries, options = {}) {
  const mergeThreshold = options.mergeThreshold || 30000; // 30 seconds default for meetings
  const merged = [];
  let current = null;

  for (const entry of entries) {
    if (current === null) {
      current = { ...entry, textParts: [entry.text] };
      continue;
    }

    const gap = entry.timestampMs - (current.endTimestampMs || current.timestampMs);
    const sameSpeaker = entry.speaker === current.speaker;

    if (sameSpeaker && gap < mergeThreshold) {
      current.textParts.push(entry.text);
      current.endTimestampMs = entry.endTimestampMs || entry.timestampMs;
    } else {
      current.text = current.textParts.join(' ');
      delete current.textParts;
      merged.push(current);
      current = { ...entry, textParts: [entry.text] };
    }
  }

  if (current) {
    current.text = current.textParts.join(' ');
    delete current.textParts;
    merged.push(current);
  }

  return merged;
}

/**
 * Format meeting entries as text
 */
function formatMeetingAsText(entries, options = {}) {
  const lines = [];

  for (const entry of entries) {
    let line = '';

    if (options.timestamps && entry.timestamp) {
      const displayTime = entry.timestamp.replace(/\.\d+$/, ''); // Remove ms
      line += `[${displayTime}] `;
    }

    if (options.speakers !== false && entry.speaker) {
      line += `${entry.speaker}: `;
    }

    line += entry.text;
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Get meeting transcript statistics
 */
function getMeetingStats(parsed) {
  if (parsed.error) return null;

  const entries = parsed.entries || [];
  const participants = parsed.metadata?.participants || [];

  // Calculate duration
  let durationMs = 0;
  if (entries.length > 0) {
    const firstMs = entries[0].timestampMs || 0;
    const lastMs = entries[entries.length - 1].endTimestampMs || entries[entries.length - 1].timestampMs || 0;
    durationMs = lastMs - firstMs;
  }

  // Word count
  const totalWords = entries.reduce((sum, e) => sum + countWords(e.text), 0);

  // Messages per speaker
  const speakerCounts = {};
  for (const entry of entries) {
    if (entry.speaker) {
      speakerCounts[entry.speaker] = (speakerCounts[entry.speaker] || 0) + 1;
    }
  }

  return {
    format: parsed.format,
    entryCount: entries.length,
    participantCount: participants.length,
    participants: participants,
    durationMs: durationMs,
    duration: msToTimestamp(durationMs),
    totalWords: totalWords,
    avgWordsPerEntry: entries.length > 0 ? Math.round(totalWords / entries.length * 10) / 10 : 0,
    speakerCounts: speakerCounts
  };
}



module.exports = {
  // VTT/SRT Constants
  VTT_TIMESTAMP_FULL,
  VTT_TIMESTAMP_SHORT,
  VTT_VOICE_TAG,
  SRT_TIMESTAMP,
  SPEAKER_COLON_PATTERN,
  SPEAKER_BRACKET_PATTERN,
  // VTT/SRT Functions
  timestampToMs,
  msToTimestamp,
  cleanSubtitleText,
  extractVTTSpeaker,
  extractSpeaker,
  parseVTT,
  parseSRT,
  mergeCues,
  parseSubtitle,
  formatCuesAsText,
  getSubtitleStats,
  // Zoom/Teams Constants
  ZOOM_PATTERNS,
  TEAMS_PATTERNS,
  // Zoom/Teams Functions
  isSystemMessage,
  parseTimeToMs,
  parseZoomChat,
  parseZoomVTT,
  parseTeamsChat,
  parseTeamsVTT,
  parseTeamsJSON,
  detectMeetingType,
  parseZoom,
  parseTeams,
  parseMeeting,
  mergeMeetingEntries,
  formatMeetingAsText,
  getMeetingStats
};
