#!/usr/bin/env node

/**
 * Wogi Flow - Language Detection Module
 *
 * Detects languages in transcript content using:
 * - Script/character set detection
 * - Common word analysis
 * - N-gram/trigram profiles
 *
 * Supports multiple languages including RTL scripts.
 * Extracted from flow-transcript-digest.js for modularity.
 */

// ==========================================================================
// E5-S1: Language Detection Functions
// ==========================================================================

/**
 * Script patterns for character set detection
 */
const SCRIPT_PATTERNS = {
  latin: /[a-zA-ZàâäéèêëïîôùûüÿçœæÀÂÄÉÈÊËÏÎÔÙÛÜŸÇŒÆáéíóúüñÁÉÍÓÚÜÑäöüßÄÖÜ]/g,
  cyrillic: /[\u0400-\u04FF]/g,
  hebrew: /[\u0590-\u05FF]/g,
  arabic: /[\u0600-\u06FF\u0750-\u077F]/g,
  cjk: /[\u4E00-\u9FFF\u3400-\u4DBF]/g,
  hiragana: /[\u3040-\u309F]/g,
  katakana: /[\u30A0-\u30FF]/g,
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF]/g,
  greek: /[\u0370-\u03FF]/g,
  thai: /[\u0E00-\u0E7F]/g,
  devanagari: /[\u0900-\u097F]/g
};

/**
 * Language metadata
 */
const LANGUAGE_INFO = {
  en: { name: 'English', script: 'latin', rtl: false },
  es: { name: 'Spanish', script: 'latin', rtl: false },
  fr: { name: 'French', script: 'latin', rtl: false },
  de: { name: 'German', script: 'latin', rtl: false },
  pt: { name: 'Portuguese', script: 'latin', rtl: false },
  it: { name: 'Italian', script: 'latin', rtl: false },
  nl: { name: 'Dutch', script: 'latin', rtl: false },
  ru: { name: 'Russian', script: 'cyrillic', rtl: false },
  he: { name: 'Hebrew', script: 'hebrew', rtl: true },
  ar: { name: 'Arabic', script: 'arabic', rtl: true },
  zh: { name: 'Chinese', script: 'cjk', rtl: false },
  ja: { name: 'Japanese', script: 'cjk', rtl: false },
  ko: { name: 'Korean', script: 'hangul', rtl: false },
  el: { name: 'Greek', script: 'greek', rtl: false },
  th: { name: 'Thai', script: 'thai', rtl: false },
  hi: { name: 'Hindi', script: 'devanagari', rtl: false },
  pl: { name: 'Polish', script: 'latin', rtl: false },
  tr: { name: 'Turkish', script: 'latin', rtl: false },
  sv: { name: 'Swedish', script: 'latin', rtl: false },
  no: { name: 'Norwegian', script: 'latin', rtl: false },
  da: { name: 'Danish', script: 'latin', rtl: false },
  fi: { name: 'Finnish', script: 'latin', rtl: false },
  vi: { name: 'Vietnamese', script: 'latin', rtl: false }
};

/**
 * Common words by language (top 30 most frequent)
 */
const COMMON_WORDS = {
  en: ['the', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does',
       'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
       'this', 'that', 'these', 'those', 'with', 'from', 'about', 'into',
       'through', 'during', 'before', 'after'],

  es: ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'en',
       'es', 'son', 'por', 'para', 'con', 'sin', 'sobre', 'como', 'pero',
       'muy', 'ya', 'aunque', 'porque', 'cuando', 'donde', 'quien',
       'cual', 'todo', 'nada', 'algo'],

  fr: ['le', 'la', 'les', 'un', 'une', 'de', 'du', 'des', 'et', 'en',
       'est', 'sont', 'avoir', 'pour', 'que', 'qui', 'dans', 'sur',
       'avec', 'plus', 'pas', 'ce', 'cette', 'ces', 'nous', 'vous',
       'ils', 'elle', 'elles', 'mais'],

  de: ['der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'und', 'ist', 'sind',
       'war', 'waren', 'hat', 'haben', 'wird', 'werden', 'kann',
       'mit', 'von', 'zu', 'bei', 'nach', 'auch', 'nur', 'noch',
       'aber', 'oder', 'wenn', 'wie', 'nicht'],

  pt: ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'que', 'em',
       'no', 'na', 'para', 'por', 'com', 'mais', 'como', 'esse',
       'essa', 'este', 'esta', 'seu', 'sua', 'ele', 'ela', 'eles',
       'elas', 'mas', 'ou'],

  it: ['il', 'la', 'i', 'le', 'lo', 'gli', 'un', 'una', 'di', 'che', 'e',
       'in', 'per', 'con', 'non', 'da', 'su', 'come', 'ma', 'anche',
       'questo', 'quella', 'questi', 'quelle', 'essere', 'avere',
       'fare', 'dire', 'potere', 'volere'],

  nl: ['de', 'het', 'een', 'van', 'en', 'in', 'is', 'zijn', 'op', 'te',
       'dat', 'die', 'voor', 'met', 'niet', 'aan', 'er', 'om', 'ook', 'als',
       'maar', 'bij', 'nog', 'wel', 'dan', 'naar', 'kan', 'zou', 'worden', 'heeft'],

  he: ['של', 'את', 'על', 'הוא', 'היא', 'הם', 'הן', 'לא', 'זה', 'כי', 'אם',
       'גם', 'יש', 'אין', 'עם', 'אל', 'מה', 'כל', 'היה', 'להיות', 'אני',
       'אתה', 'את', 'אנחנו', 'הזה', 'הזאת', 'עוד', 'רק', 'כמו', 'אבל'],

  ru: ['и', 'в', 'не', 'на', 'я', 'что', 'он', 'с', 'как', 'это',
       'она', 'они', 'но', 'по', 'из', 'за', 'все', 'так', 'его', 'же',
       'от', 'для', 'или', 'было', 'бы', 'мне', 'вы', 'мы', 'был', 'быть']
};

/**
 * Common trigrams by language
 */
const TRIGRAM_PROFILES = {
  en: ['the', 'and', 'ing', 'ion', 'tio', 'ent', 'ati', 'for', 'her', 'ter',
       'hat', 'tha', 'ere', 'ate', 'his', 'con', 'res', 'ver', 'all', 'ons'],
  es: ['que', 'ent', 'ade', 'los', 'del', 'est', 'con', 'nte', 'par',
       'las', 'cia', 'era', 'ien', 'com', 'res', 'sta', 'tra', 'pro', 'una', 'por'],
  fr: ['ent', 'que', 'les', 'ion', 'tio', 'men', 'ait', 'ons', 'ant', 'our',
       'des', 'eur', 'par', 'est', 'eme', 'com', 'ous', 'ter', 'con', 'dan'],
  de: ['der', 'und', 'den', 'ein', 'che', 'die', 'sch', 'ung', 'ich', 'ter',
       'ent', 'gen', 'das', 'ber', 'ine', 'eit', 'mit', 'ren', 'nen', 'ver']
};

/**
 * Detect script types in text
 */
function detectScript(text) {
  const scripts = {};
  let total = 0;

  for (const [name, pattern] of Object.entries(SCRIPT_PATTERNS)) {
    const matches = text.match(pattern) || [];
    if (matches.length > 0) {
      scripts[name] = matches.length;
      total += matches.length;
    }
  }

  // Calculate percentages
  const percentages = {};
  for (const [name, count] of Object.entries(scripts)) {
    percentages[name] = total > 0 ? count / total : 0;
  }

  return { counts: scripts, percentages, total };
}

/**
 * Clean text for language detection
 */
function cleanForDetection(text) {
  return text
    // Remove timestamps
    .replace(/\d{1,2}:\d{2}(:\d{2})?(\.\d+)?/g, '')
    // Remove speaker labels
    .replace(/^[A-Z][a-z]+\s[A-Z][a-z]+:/gm, '')
    .replace(/<v\s+[^>]+>/g, '')
    // Remove URLs
    .replace(/https?:\/\/[^\s]+/g, '')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract word tokens from text
 */
function extractWords(text) {
  // Handle different scripts
  const words = text.toLowerCase().match(/[\p{L}]+/gu) || [];
  return words.filter(w => w.length > 1);
}

/**
 * Analyze common words to score languages
 */
function analyzeCommonWords(text) {
  const words = extractWords(text);
  const wordSet = new Set(words);
  const scores = {};

  for (const [lang, commonList] of Object.entries(COMMON_WORDS)) {
    let matches = 0;
    for (const word of commonList) {
      if (wordSet.has(word)) {
        matches++;
      }
    }
    // Also count occurrences
    let occurrences = 0;
    for (const word of words) {
      if (commonList.includes(word)) {
        occurrences++;
      }
    }
    scores[lang] = {
      uniqueMatches: matches,
      totalOccurrences: occurrences,
      score: words.length > 0 ? occurrences / words.length : 0
    };
  }

  return scores;
}

/**
 * Extract trigrams from text
 */
function extractTrigrams(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z]/g, '');
  const trigrams = [];
  for (let i = 0; i < cleaned.length - 2; i++) {
    trigrams.push(cleaned.substring(i, i + 3));
  }
  return trigrams;
}

/**
 * Analyze trigrams to score languages
 */
function analyzeNgrams(text) {
  const trigrams = extractTrigrams(text);
  const trigramSet = new Set(trigrams);
  const scores = {};

  for (const [lang, profile] of Object.entries(TRIGRAM_PROFILES)) {
    let matches = 0;
    for (const trigram of profile) {
      if (trigramSet.has(trigram)) {
        matches++;
      }
    }
    scores[lang] = {
      matches: matches,
      score: profile.length > 0 ? matches / profile.length : 0
    };
  }

  return scores;
}

/**
 * Combine detection signals into final scores
 */
function combineLanguageScores(scriptResult, wordResult, ngramResult) {
  const scores = {};

  // Script-based detection for non-Latin scripts
  if (scriptResult.percentages.hebrew > 0.3) {
    scores.he = (scores.he || 0) + scriptResult.percentages.hebrew;
  }
  if (scriptResult.percentages.arabic > 0.3) {
    scores.ar = (scores.ar || 0) + scriptResult.percentages.arabic;
  }
  if (scriptResult.percentages.cyrillic > 0.3) {
    scores.ru = (scores.ru || 0) + scriptResult.percentages.cyrillic;
  }
  if (scriptResult.percentages.cjk > 0.3) {
    // Could be Chinese or Japanese
    if (scriptResult.percentages.hiragana > 0.1 || scriptResult.percentages.katakana > 0.1) {
      scores.ja = (scores.ja || 0) + scriptResult.percentages.cjk;
    } else {
      scores.zh = (scores.zh || 0) + scriptResult.percentages.cjk;
    }
  }
  if (scriptResult.percentages.hangul > 0.3) {
    scores.ko = (scores.ko || 0) + scriptResult.percentages.hangul;
  }
  if (scriptResult.percentages.greek > 0.3) {
    scores.el = (scores.el || 0) + scriptResult.percentages.greek;
  }
  if (scriptResult.percentages.thai > 0.3) {
    scores.th = (scores.th || 0) + scriptResult.percentages.thai;
  }
  if (scriptResult.percentages.devanagari > 0.3) {
    scores.hi = (scores.hi || 0) + scriptResult.percentages.devanagari;
  }

  // Word-based scoring (weighted 0.5)
  for (const [lang, data] of Object.entries(wordResult)) {
    scores[lang] = (scores[lang] || 0) + data.score * 0.5;
  }

  // N-gram scoring (weighted 0.3)
  for (const [lang, data] of Object.entries(ngramResult)) {
    scores[lang] = (scores[lang] || 0) + data.score * 0.3;
  }

  // Normalize scores
  const maxScore = Math.max(...Object.values(scores), 0.001);
  for (const lang of Object.keys(scores)) {
    scores[lang] = scores[lang] / maxScore;
  }

  return scores;
}

/**
 * Detect primary language of text
 */
function detectLanguage(text, options = {}) {
  const minLength = options.minLength || 20;

  // Clean text
  const cleaned = cleanForDetection(text);
  if (cleaned.length < minLength) {
    return {
      language: 'unknown',
      languageName: 'Unknown',
      confidence: 0,
      reason: 'insufficient_text'
    };
  }

  // Analyze
  const scriptResult = detectScript(cleaned);
  const wordResult = analyzeCommonWords(cleaned);
  const ngramResult = analyzeNgrams(cleaned);

  // Combine scores
  const scores = combineLanguageScores(scriptResult, wordResult, ngramResult);

  // Sort by score
  const sorted = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return {
      language: 'unknown',
      languageName: 'Unknown',
      confidence: 0
    };
  }

  const primary = sorted[0];
  const secondary = sorted.length > 1 && sorted[1][1] > 0.3 ? sorted[1] : null;

  return {
    language: primary[0],
    languageName: LANGUAGE_INFO[primary[0]]?.name || primary[0],
    confidence: Math.min(primary[1], 1),
    secondary: secondary ? {
      language: secondary[0],
      languageName: LANGUAGE_INFO[secondary[0]]?.name || secondary[0],
      confidence: Math.min(secondary[1], 1)
    } : null,
    scripts: scriptResult.counts,
    wordMatches: Object.fromEntries(
      Object.entries(wordResult)
        .filter(([_, d]) => d.totalOccurrences > 0)
        .map(([lang, d]) => [lang, d.totalOccurrences])
    ),
    allScores: scores
  };
}

/**
 * Detect multiple languages in text (for mixed content)
 */
function detectMultipleLanguages(text, options = {}) {
  const segmentSize = options.segmentSize || 300;

  // Split into segments
  const words = text.split(/\s+/);
  const segments = [];
  for (let i = 0; i < words.length; i += segmentSize / 5) {
    const segmentWords = words.slice(i, i + segmentSize / 5);
    if (segmentWords.length > 10) {
      segments.push(segmentWords.join(' '));
    }
  }

  if (segments.length === 0) {
    return detectLanguage(text, options);
  }

  // Analyze each segment
  const languageCounts = {};
  const segmentResults = [];

  for (const segment of segments) {
    const result = detectLanguage(segment, { minLength: 10 });
    if (result.language !== 'unknown' && result.confidence > 0.3) {
      languageCounts[result.language] = (languageCounts[result.language] || 0) + 1;
      segmentResults.push({
        preview: segment.substring(0, 50) + (segment.length > 50 ? '...' : ''),
        language: result.language,
        confidence: result.confidence
      });
    }
  }

  // Calculate distribution
  const total = Object.values(languageCounts).reduce((a, b) => a + b, 0);
  const distribution = {};
  for (const [lang, count] of Object.entries(languageCounts)) {
    distribution[lang] = total > 0 ? count / total : 0;
  }

  const sortedLangs = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  const primaryLang = sortedLangs[0]?.[0] || 'unknown';

  return {
    language: primaryLang,
    languageName: LANGUAGE_INFO[primaryLang]?.name || primaryLang,
    confidence: distribution[primaryLang] || 0,
    isMultilingual: Object.keys(distribution).length > 1,
    distribution: distribution,
    segmentCount: segments.length,
    segments: segmentResults.slice(0, 10) // Limit to first 10
  };
}

/**
 * Get language info by code
 */
function getLanguageInfo(code) {
  const info = LANGUAGE_INFO[code];
  if (!info) {
    return { code, name: 'Unknown', script: 'unknown', rtl: false, supported: false };
  }
  return {
    code,
    ...info,
    hasCommonWords: !!COMMON_WORDS[code],
    hasTrigrams: !!TRIGRAM_PROFILES[code],
    supported: true
  };
}

/**
 * List all supported languages
 */
function listSupportedLanguages() {
  return Object.entries(LANGUAGE_INFO).map(([code, info]) => ({
    code,
    ...info,
    tier: COMMON_WORDS[code] ? (TRIGRAM_PROFILES[code] ? 1 : 2) : 3
  }));
}



module.exports = {
  // Constants
  SCRIPT_PATTERNS,
  LANGUAGE_INFO,
  COMMON_WORDS,
  TRIGRAM_PROFILES,
  // Functions
  detectScript,
  cleanForDetection,
  extractWords,
  analyzeCommonWords,
  extractTrigrams,
  analyzeNgrams,
  combineLanguageScores,
  detectLanguage,
  detectMultipleLanguages,
  getLanguageInfo,
  listSupportedLanguages
};
