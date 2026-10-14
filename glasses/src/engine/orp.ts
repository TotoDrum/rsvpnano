// Optimal Recognition Point placement, ported from ReaderScreen::focusOffset.
//
// The G2 firmware renders all text in one proportional font with no alignment
// options, so a word can't be anchored on its focus letter directly. Instead we
// estimate glyph widths and left-pad with spaces so the focus letter lands near
// a fixed column. The estimate is tunable from the phone (fontScale).

/** Same table as focusOrdinal() in ReaderScreen.cpp. */
export function focusOrdinal(length: number): number {
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}

/** Index (in code points) of the focus letter, or -1 for an empty word. */
export function focusIndex(word: string): number {
  const chars = [...word];
  const wordCharPositions: number[] = [];
  chars.forEach((c, i) => {
    if (/[\p{L}\p{N}]/u.test(c)) wordCharPositions.push(i);
  });
  if (wordCharPositions.length === 0) return chars.length ? 0 : -1;
  const target = Math.min(focusOrdinal(wordCharPositions.length), wordCharPositions.length - 1);
  return wordCharPositions[target];
}

// Relative glyph widths for a typical proportional sans font, in "em-ish" units.
const NARROW = new Set([...'il.,:;\'!|`ı']);
const SEMI_NARROW = new Set([...'fjrtI()[]{}"-/\\1']);
const WIDE = new Set([...'mwMW@%']);
const SEMI_WIDE = new Set([...'ABCDGHKNOQRUVXY&']);

export function glyphWidth(c: string): number {
  if (c === ' ') return 0.32;
  if (NARROW.has(c)) return 0.3;
  if (SEMI_NARROW.has(c)) return 0.45;
  if (WIDE.has(c)) return 1.05;
  if (SEMI_WIDE.has(c)) return 0.8;
  if (/\p{Lu}/u.test(c)) return 0.7;
  return 0.62;
}

export function textWidth(text: string): number {
  let w = 0;
  for (const c of text) w += glyphWidth(c);
  return w;
}

export interface AnchorLayout {
  /** Word padded with leading spaces so its focus letter sits on the anchor. */
  line: string;
  /** A guide mark padded to the same column. */
  guide: string;
}

/**
 * @param anchorUnits column of the anchor, in glyph-width units from the left edge
 * @param mode 'orp' anchors the focus letter, 'center' centers the whole word
 */
export function layoutWord(word: string, anchorUnits: number, mode: 'orp' | 'center', guideChar = '|'): AnchorLayout {
  const space = glyphWidth(' ');
  const padFor = (units: number) => ' '.repeat(Math.max(0, Math.round(units / space)));
  const guide = padFor(anchorUnits - glyphWidth(guideChar) / 2) + guideChar;
  if (!word) return { line: '', guide };

  let before: number;
  if (mode === 'center') {
    before = textWidth(word) / 2;
  } else {
    const chars = [...word];
    const idx = Math.max(0, focusIndex(word));
    before = textWidth(chars.slice(0, idx).join('')) + glyphWidth(chars[idx]) / 2;
  }
  return { line: padFor(anchorUnits - before) + word, guide };
}
