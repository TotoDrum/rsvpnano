// TypeScript port of the word timing model in src/reader/ReadingLoop.cpp.
// Each word gets the base interval (60000 / wpm) plus bonuses for length,
// complexity and trailing punctuation, scaled by the user's pacing delays.

export interface PacingSettings {
  longWordDelayMs: number;
  complexWordDelayMs: number;
  punctuationDelayMs: number;
}

export const DEFAULT_PACING: PacingSettings = {
  longWordDelayMs: 200,
  complexWordDelayMs: 200,
  punctuationDelayMs: 200,
};

const LONG_WORD_AFTER_CHARS = 6;
const LONG_WORD_PERCENT_PER_CHAR = 6;
const VERY_LONG_WORD_AFTER_CHARS = 10;
const VERY_LONG_WORD_PERCENT_PER_CHAR = 9;
const ULTRA_LONG_WORD_AFTER_CHARS = 14;
const ULTRA_LONG_WORD_PERCENT_PER_CHAR = 12;
const LONG_WORD_MAX_PERCENT = 170;
const COMPOUND_JOINER_PERCENT = 14;
const LONG_COMPOUND_WORD_PERCENT = 18;
const TECHNICAL_CONNECTOR_PERCENT = 8;
const SYLLABLE_BONUS_AFTER_COUNT = 2;
const SYLLABLE_BONUS_PERCENT_PER_GROUP = 10;
const SYLLABLE_BONUS_MAX_PERCENT = 50;
const ALL_CAPS_COMPLEXITY_PERCENT = 14;
const MIXED_TOKEN_COMPLEXITY_PERCENT = 22;
const NUMERIC_TOKEN_COMPLEXITY_PERCENT = 10;
const DENSE_CONNECTOR_COMPLEXITY_PERCENT = 12;
const COMPLEX_WORD_MAX_PERCENT = 85;
const COMMA_PAUSE_PERCENT = 45;
const DASH_PAUSE_PERCENT = 60;
const CLAUSE_PAUSE_PERCENT = 80;
const ELLIPSIS_PAUSE_PERCENT = 110;
const SENTENCE_PAUSE_PERCENT = 135;
const STRONG_SENTENCE_PAUSE_PERCENT = 150;

const KNOWN_ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.', 'vs.', 'etc.', 'e.g.',
  'i.e.', 'cf.', 'no.', 'fig.', 'eq.', 'inc.', 'ltd.', 'co.', 'dept.', 'mt.', 'ft.',
]);

const isLetter = (c: string) => /\p{L}/u.test(c);
const isDigit = (c: string) => /\p{Nd}/u.test(c);
const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);
const isUpper = (c: string) => /\p{Lu}/u.test(c);
const isLower = (c: string) => /\p{Ll}/u.test(c);
const isVowel = (c: string) => 'aeiouyàáâäãåæèéêëìíîïòóôöõøœùúûüýÿ'.includes(c);
const isSegmentSeparator = (c: string) => c === '-' || c === '/' || c === '_';
const isTechnicalConnector = (c: string) => '-/_.+\\'.includes(c);
const IGNORED_TRAILING = new Set(['"', "'", ')', ']', '}', '’', '”']);

function count(word: string, predicate: (c: string) => boolean): number {
  let n = 0;
  for (const c of word) if (predicate(c)) n++;
  return n;
}

function connectorCount(word: string, predicate: (c: string) => boolean): number {
  const chars = [...word];
  let n = 0;
  for (let i = 1; i + 1 < chars.length; i++) {
    if (predicate(chars[i]) && isWordChar(chars[i - 1]) && isWordChar(chars[i + 1])) n++;
  }
  return n;
}

function approximateSyllableGroups(word: string): number {
  let groups = 0;
  let letters = 0;
  let previousWasVowel = false;
  let previousLetter = '';
  let lastLetter = '';
  for (const c of word) {
    if (!isLetter(c)) {
      previousWasVowel = false;
      continue;
    }
    letters++;
    const lower = c.toLowerCase();
    previousLetter = lastLetter;
    lastLetter = lower;
    const vowel = isVowel(lower);
    if (vowel && !previousWasVowel) groups++;
    previousWasVowel = vowel;
  }
  if (groups > 1 && letters > 3 && lastLetter === 'e' && previousLetter !== 'l' && previousLetter !== 'y') groups--;
  if (groups === 0 && letters > 0) groups = 1;
  return groups;
}

function stripTrailing(word: string): string {
  const chars = [...word];
  while (chars.length && IGNORED_TRAILING.has(chars[chars.length - 1])) chars.pop();
  return chars.join('');
}

function trailingRhythmChar(word: string): string {
  const stripped = [...stripTrailing(word)];
  const c = stripped[stripped.length - 1] ?? '';
  const fullwidth: Record<string, string> = {
    '、': ',', '，': ',', '。': '.', '！': '!', '：': ':', '；': ';', '？': '?',
  };
  return fullwidth[c] ?? c;
}

function endsWithEllipsis(word: string): boolean {
  const s = stripTrailing(word);
  return s.endsWith('…') || s.endsWith('...');
}

function isDottedInitialism(word: string): boolean {
  const s = stripTrailing(word);
  return /^(\p{L}\.){2,}$/u.test(s);
}

export function looksLikeAbbreviation(word: string, nextWordStartsLowercase: boolean): boolean {
  if (KNOWN_ABBREVIATIONS.has(word.toLowerCase())) return true;
  if (!word.endsWith('.')) return false;
  if (isDottedInitialism(word)) return true;
  const readable = count(word, isWordChar);
  if (readable <= 2) return true;
  if (nextWordStartsLowercase && readable <= 4) return true;
  return false;
}

export function startsWithLowercase(word: string | undefined): boolean {
  if (!word) return false;
  for (const c of word) {
    if (isLower(c)) return true;
    if (isLetter(c)) return false;
  }
  return false;
}

function lengthBonusPercent(word: string): number {
  const readable = count(word, isWordChar);
  if (readable === 0) return 0;
  let bonus = 0;
  if (readable > LONG_WORD_AFTER_CHARS) bonus += (readable - LONG_WORD_AFTER_CHARS) * LONG_WORD_PERCENT_PER_CHAR;
  if (readable > VERY_LONG_WORD_AFTER_CHARS)
    bonus += (readable - VERY_LONG_WORD_AFTER_CHARS) * VERY_LONG_WORD_PERCENT_PER_CHAR;
  if (readable > ULTRA_LONG_WORD_AFTER_CHARS)
    bonus += (readable - ULTRA_LONG_WORD_AFTER_CHARS) * ULTRA_LONG_WORD_PERCENT_PER_CHAR;
  const joiners = connectorCount(word, isSegmentSeparator);
  if (joiners > 0) {
    bonus += joiners * COMPOUND_JOINER_PERCENT;
    if (readable >= VERY_LONG_WORD_AFTER_CHARS) bonus += LONG_COMPOUND_WORD_PERCENT;
  }
  const tech = connectorCount(word, isTechnicalConnector);
  if (tech > joiners) bonus += (tech - joiners) * TECHNICAL_CONNECTOR_PERCENT;
  return Math.min(LONG_WORD_MAX_PERCENT, bonus);
}

function complexityBonusPercent(word: string): number {
  let bonus = 0;
  const syllables = approximateSyllableGroups(word);
  if (syllables > SYLLABLE_BONUS_AFTER_COUNT) {
    bonus += Math.min(SYLLABLE_BONUS_MAX_PERCENT, (syllables - SYLLABLE_BONUS_AFTER_COUNT) * SYLLABLE_BONUS_PERCENT_PER_GROUP);
  }
  const letters = count(word, isLetter);
  const digits = count(word, isDigit);
  const upper = count(word, isUpper);
  if (letters > 0 && digits > 0) bonus += MIXED_TOKEN_COMPLEXITY_PERCENT;
  else if (digits >= 3) bonus += NUMERIC_TOKEN_COMPLEXITY_PERCENT;
  if (upper >= 2 && upper === letters) bonus += ALL_CAPS_COMPLEXITY_PERCENT;
  const tech = connectorCount(word, isTechnicalConnector);
  if (tech >= 2) bonus += (tech - 1) * DENSE_CONNECTOR_COMPLEXITY_PERCENT;
  return Math.min(COMPLEX_WORD_MAX_PERCENT, bonus);
}

export function punctuationPausePercent(word: string, nextWordStartsLowercase: boolean): number {
  if (endsWithEllipsis(word)) return ELLIPSIS_PAUSE_PERCENT;
  switch (trailingRhythmChar(word)) {
    case ',':
      return COMMA_PAUSE_PERCENT;
    case '-':
    case '—':
      return DASH_PAUSE_PERCENT;
    case ';':
    case ':':
      return CLAUSE_PAUSE_PERCENT;
    case '.':
      return looksLikeAbbreviation(word, nextWordStartsLowercase) ? 0 : SENTENCE_PAUSE_PERCENT;
    case '!':
    case '?':
      return STRONG_SENTENCE_PAUSE_PERCENT;
    default:
      return 0;
  }
}

const scaled = (percent: number, delayMs: number) => Math.floor((percent * delayMs) / 100);

export function wordDurationMs(word: string, nextWord: string | undefined, wpm: number, pacing: PacingSettings): number {
  const base = Math.floor(60000 / Math.max(1, wpm));
  if (!word) return base;
  const nextLower = startsWithLowercase(nextWord);
  return (
    base +
    scaled(lengthBonusPercent(word), pacing.longWordDelayMs) +
    scaled(complexityBonusPercent(word), pacing.complexWordDelayMs) +
    scaled(punctuationPausePercent(word, nextLower), pacing.punctuationDelayMs)
  );
}

export function endsSentence(word: string, nextWord: string | undefined): boolean {
  const c = trailingRhythmChar(word);
  if (c === '!' || c === '?') return true;
  if (c === '.') return !looksLikeAbbreviation(word, startsWithLowercase(nextWord));
  return false;
}
