'use strict';

/**
 * Long Input Processing - Voice Answer Integration (E2-S3)
 *
 * Handles voice-transcribed input normalization: filler removal,
 * self-correction detection, number normalization, uncertainty
 * detection, and yes/no pattern matching.
 *
 * Extracted from flow-long-input.js.
 */

// ============================================
// Voice Constants
// ============================================

/**
 * Voice filler patterns to remove
 */
const VOICE_FILLERS = [
  // Pure fillers (always remove)
  /\b(um|uh|er|ah|hmm+)\b/gi,
  // Hedge words (remove when standalone)
  /\b(like)\b(?!\s+(?:this|that|the|a|an))/gi,
  /\b(you know)\b/gi,
  /\b(basically)\b/gi,
  // Thinking pauses at start
  /^(so+|well|anyway|let me think|let me see)[,\s]*/gi,
  // Repeated words (stutters)
  /\b(\w+)\s+\1\b/gi
];

/**
 * Voice correction patterns
 */
const VOICE_CORRECTIONS = [
  { pattern: /(.+?)\s*(?:wait|no wait)\s*,?\s*(.+)/i, use: 2, type: 'wait_correction' },
  { pattern: /(.+?)\s*(?:actually)\s*,?\s*(.+)/i, use: 2, type: 'actually_correction' },
  { pattern: /(.+?)\s*(?:I mean)\s*,?\s*(.+)/i, use: 2, type: 'i_mean_correction' },
  { pattern: /(.+?)\s*(?:scratch that|forget that|never mind)\s*,?\s*(.*)/i, use: 2, type: 'scratch_that' },
  { pattern: /(?:not|don't)\s+(.+?)\s*,?\s*(?:but|instead)\s+(.+)/i, use: 2, type: 'negation_correction' }
];

/**
 * Uncertainty markers for voice
 */
const VOICE_UNCERTAINTY = [
  /\b(maybe|perhaps|probably|I think|I guess|not sure|possibly)\b/i,
  /\b(or something|something like|kind of|sort of)\b/i,
  /\b(could be|might be|either|whatever works)\b/i
];

/**
 * Yes/No patterns for voice
 */
const VOICE_YES_PATTERNS = [
  /^(yes|yeah|yep|yup|sure|definitely|absolutely|of course|right)\b/i,
  /^(that works|sounds good|perfect|exactly|correct)\b/i,
  /^(I think so|probably yes|I'd say yes)\b/i
];

const VOICE_NO_PATTERNS = [
  /^(no|nope|nah|not really|I don't think so)\b/i,
  /^(that's not|we don't need|skip that|let's not)\b/i,
  /^(maybe not|probably not|I'd say no)\b/i
];

/**
 * Number word to digit mapping
 */
const NUMBER_WORDS = {
  'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
  'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
  'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
  'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
  'eighteen': '18', 'nineteen': '19', 'twenty': '20', 'thirty': '30',
  'forty': '40', 'fifty': '50', 'hundred': '100'
};

// ============================================
// Voice Functions
// ============================================

/**
 * Detect if input appears to be voice-transcribed
 */
function isVoiceInput(text) {
  const lowerText = text.toLowerCase();
  let voiceSignals = 0;

  // Check for filler words
  const fillerCount = (lowerText.match(/\b(um|uh|er|ah|like|you know|basically)\b/gi) || []).length;
  if (fillerCount >= 2) voiceSignals += 2;
  else if (fillerCount >= 1) voiceSignals += 1;

  // Check for self-corrections
  if (/\b(actually|wait|I mean|scratch that)\b/i.test(lowerText)) {
    voiceSignals += 1;
  }

  // Check for informal patterns
  if (/\b(yeah|yep|nope|gonna|wanna|kinda|sorta)\b/i.test(lowerText)) {
    voiceSignals += 1;
  }

  // Check for run-on sentences (lack of punctuation)
  const wordCount = text.split(/\s+/).length;
  const sentenceCount = text.split(/[.!?]/).filter(s => s.trim()).length;
  if (wordCount > 10 && sentenceCount <= 1) {
    voiceSignals += 1;
  }

  return {
    isVoice: voiceSignals >= 2,
    confidence: Math.min(voiceSignals / 4, 1.0),
    signals: voiceSignals
  };
}

/**
 * Remove filler words from voice input
 */
function removeFillers(text) {
  let result = text;
  let fillersRemoved = 0;

  for (const pattern of VOICE_FILLERS) {
    const matches = result.match(pattern);
    if (matches) {
      fillersRemoved += matches.length;
    }
    result = result.replace(pattern, ' ');
  }

  // Clean up extra spaces
  result = result.replace(/\s+/g, ' ').trim();

  return { text: result, fillersRemoved };
}

/**
 * Apply self-corrections from voice input
 */
function applySelfCorrections(text) {
  let result = text;
  const corrections = [];

  for (const { pattern, use, type } of VOICE_CORRECTIONS) {
    const match = result.match(pattern);
    if (match) {
      const correctedPart = match[use]?.trim();
      if (correctedPart && correctedPart.length > 0) {
        // For "scratch that" with no replacement, use what came before
        if (type === 'scratch_that' && !correctedPart) {
          continue;
        }
        corrections.push({
          type,
          original: match[1]?.trim(),
          corrected: correctedPart
        });
        result = correctedPart;
      }
    }
  }

  return { text: result, corrections };
}

/**
 * Normalize spoken numbers to digits
 */
function normalizeNumbers(text) {
  let result = text;
  let numbersNormalized = 0;

  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    const pattern = new RegExp(`\\b${word}\\b`, 'gi');
    if (pattern.test(result)) {
      numbersNormalized++;
      result = result.replace(pattern, digit);
    }
  }

  return { text: result, numbersNormalized };
}

/**
 * Detect uncertainty in voice answer
 */
function detectUncertainty(text) {
  const markers = [];

  for (const pattern of VOICE_UNCERTAINTY) {
    const match = text.match(pattern);
    if (match) {
      markers.push(match[0].toLowerCase());
    }
  }

  return {
    hasUncertainty: markers.length > 0,
    markers,
    needsConfirmation: markers.length >= 2
  };
}

/**
 * Check for yes/no voice patterns
 */
function detectYesNo(text) {
  const trimmed = text.trim();

  for (const pattern of VOICE_YES_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: 'yes', confidence: 0.9 };
    }
  }

  for (const pattern of VOICE_NO_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { type: 'no', confidence: 0.9 };
    }
  }

  return { type: null, confidence: 0 };
}

/**
 * Add basic punctuation to run-on voice text
 */
function addPunctuation(text) {
  let result = text;

  // Add periods before topic change words
  result = result.replace(/\s+(and then|next|also|another thing|moving on)\s+/gi, '. $1 ');

  // Add periods before enumeration
  result = result.replace(/\s+(first|second|third|finally|lastly)\s+/gi, '. $1 ');

  // Capitalize after periods
  result = result.replace(/\.\s+(\w)/g, (match, letter) => `. ${letter.toUpperCase()}`);

  // Ensure ends with punctuation
  if (!/[.!?]$/.test(result.trim())) {
    result = result.trim() + '.';
  }

  // Capitalize first letter
  result = result.charAt(0).toUpperCase() + result.slice(1);

  return result;
}

/**
 * Full voice normalization pipeline
 */
function normalizeVoiceInput(text) {
  const processing = {
    original: text,
    isVoice: false,
    voiceConfidence: 0,
    fillersRemoved: 0,
    corrections: [],
    numbersNormalized: 0,
    uncertainty: { hasUncertainty: false, markers: [] },
    yesNo: { type: null }
  };

  // Detect if voice
  const voiceDetection = isVoiceInput(text);
  processing.isVoice = voiceDetection.isVoice;
  processing.voiceConfidence = voiceDetection.confidence;

  let normalized = text;

  // Always apply normalization if voice detected, or if explicitly marked as voice
  if (voiceDetection.isVoice || processing.forceVoice) {
    // Step 1: Remove fillers
    const fillerResult = removeFillers(normalized);
    normalized = fillerResult.text;
    processing.fillersRemoved = fillerResult.fillersRemoved;

    // Step 2: Apply self-corrections
    const correctionResult = applySelfCorrections(normalized);
    normalized = correctionResult.text;
    processing.corrections = correctionResult.corrections;

    // Step 3: Normalize numbers
    const numberResult = normalizeNumbers(normalized);
    normalized = numberResult.text;
    processing.numbersNormalized = numberResult.numbersNormalized;

    // Step 4: Add punctuation if needed
    if (normalized.split(/[.!?]/).filter(s => s.trim()).length <= 1 && normalized.split(/\s+/).length > 5) {
      normalized = addPunctuation(normalized);
    }
  }

  // Step 5: Detect uncertainty (always)
  processing.uncertainty = detectUncertainty(normalized);

  // Step 6: Check for yes/no (always)
  processing.yesNo = detectYesNo(normalized);

  processing.normalized = normalized;

  return processing;
}

/**
 * Calculate voice-adjusted confidence
 */
function calculateVoiceConfidence(processing) {
  let confidence = 0.8; // Base for voice (vs 0.9 for text)

  // Reduce for uncertainty
  if (processing.uncertainty.markers.length > 0) {
    confidence -= 0.1 * Math.min(processing.uncertainty.markers.length, 2);
  }

  // Reduce for heavy correction (indicates confusion)
  if (processing.corrections.length > 2) {
    confidence -= 0.1;
  }

  // Increase for clear yes/no
  if (processing.yesNo.type) {
    confidence = Math.max(confidence, 0.85);
  }

  // Increase for clear, short answers
  if (processing.normalized.split(/\s+/).length <= 5 && processing.fillersRemoved === 0) {
    confidence += 0.05;
  }

  return Math.max(0.5, Math.min(1.0, confidence));
}

/**
 * Process voice answer with full pipeline
 */
function processVoiceAnswer(text, forceVoice = false) {
  const processing = normalizeVoiceInput(text);
  processing.forceVoice = forceVoice;

  // Recalculate if forced
  if (forceVoice && !processing.isVoice) {
    processing.isVoice = true;
    const reprocessed = normalizeVoiceInput(text);
    Object.assign(processing, reprocessed, { isVoice: true, forceVoice: true });
  }

  const confidence = calculateVoiceConfidence(processing);

  return {
    original: text,
    normalized: processing.normalized,
    isVoice: processing.isVoice || forceVoice,
    confidence,
    processing: {
      fillersRemoved: processing.fillersRemoved,
      corrections: processing.corrections,
      numbersNormalized: processing.numbersNormalized,
      uncertainty: processing.uncertainty,
      yesNo: processing.yesNo
    }
  };
}

module.exports = {
  // Constants
  VOICE_FILLERS,
  VOICE_CORRECTIONS,
  VOICE_UNCERTAINTY,
  VOICE_YES_PATTERNS,
  VOICE_NO_PATTERNS,
  NUMBER_WORDS,
  // Functions
  isVoiceInput,
  removeFillers,
  applySelfCorrections,
  normalizeNumbers,
  detectUncertainty,
  detectYesNo,
  addPunctuation,
  normalizeVoiceInput,
  calculateVoiceConfidence,
  processVoiceAnswer
};
