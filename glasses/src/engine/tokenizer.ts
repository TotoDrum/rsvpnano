// Simplified TypeScript port of src/text/RsvpTokenizer.h.
// Splits normalized text into RSVP tokens and records paragraph boundaries.

export interface TokenizedText {
  words: string[];
  /** Index of the first word of each paragraph, ascending. Always starts with 0 when words exist. */
  paragraphStarts: number[];
}

/** Words longer than this are split so they still fit on one glasses line. */
export const MAX_TOKEN_CHARS = 20;
const SPLIT_CHUNK_CHARS = 16;

const DASHES = new Set(['-', '--', '–', '—']);

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, '...')
    .replace(/\t/g, ' ');
}

function splitLongToken(token: string): string[] {
  if ([...token].length <= MAX_TOKEN_CHARS) return [token];
  // Prefer existing hyphens or slashes as break points.
  const parts = token.split(/(?<=[-/])/);
  if (parts.length > 1 && parts.every((p) => [...p].length <= MAX_TOKEN_CHARS)) return parts;
  const chars = [...token];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += SPLIT_CHUNK_CHARS) {
    const chunk = chars.slice(i, i + SPLIT_CHUNK_CHARS).join('');
    out.push(i + SPLIT_CHUNK_CHARS < chars.length ? `${chunk}-` : chunk);
  }
  return out;
}

export function tokenize(text: string): TokenizedText {
  const words: string[] = [];
  const paragraphStarts: number[] = [];
  const paragraphs = normalizeText(text).split(/\n\s*\n+/);

  for (const paragraph of paragraphs) {
    const rawTokens = paragraph.split(/\s+/).filter((t) => t.length > 0);
    if (rawTokens.length === 0) continue;
    const start = words.length;

    for (const raw of rawTokens) {
      // A standalone ellipsis joins the previous word, as in the firmware tokenizer.
      if (/^\.{3,}$/.test(raw)) {
        if (words.length > start) words[words.length - 1] += '...';
        continue;
      }
      if (DASHES.has(raw)) {
        words.push('-');
        continue;
      }
      // Skip tokens with nothing readable (stray symbols from conversion).
      if (!/[\p{L}\p{N}]/u.test(raw)) {
        if (words.length > start && /^[.,;:!?)"'\]]+$/.test(raw)) words[words.length - 1] += raw;
        continue;
      }
      words.push(...splitLongToken(raw));
    }

    if (words.length > start) paragraphStarts.push(start);
  }

  return { words, paragraphStarts };
}
