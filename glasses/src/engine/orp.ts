// Optimal Recognition Point placement, ported from ReaderScreen::focusOffset.
//
// The G2 firmware renders all text in one proportional font with no alignment
// options, so a word can't be anchored on its focus letter directly. Instead we
// measure it with Even's firmware font metrics and left-pad with spaces so the
// focus letter lands within half a space of a fixed column.
import { getTextWidth } from '@evenrealities/pretext';

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

export interface AnchorLayout {
  /** Word padded with leading spaces so its focus letter sits on the anchor. */
  line: string;
  /** A guide mark padded to the same column. */
  guide: string;
}

/**
 * @param anchorPx column of the anchor, in pixels from the container's left edge
 * @param mode 'orp' anchors the focus letter, 'center' centers the whole word
 */
export function layoutWord(word: string, anchorPx: number, mode: 'orp' | 'center', guideChar = '|'): AnchorLayout {
  const guide = pad(guideChar, getTextWidth(guideChar) / 2, anchorPx) + guideChar;
  if (!word) return { line: '', guide };

  if (mode === 'center') return { line: pad(word, getTextWidth(word) / 2, anchorPx) + word, guide };

  // Measure through the focus letter so kerning against the previous glyph counts.
  const chars = [...word];
  const idx = Math.max(0, focusIndex(word));
  const throughFocus = chars.slice(0, idx + 1).join('');
  return { line: pad(throughFocus, getTextWidth(chars[idx]) / 2, anchorPx) + word, guide };
}

/**
 * Leading spaces that put the point `back` px before the end of `text` closest to
 * `anchorPx`. Checks neighbouring counts against the real padded width, since
 * per-glyph rounding and kerning against the spaces can shift it by a pixel or two.
 */
function pad(text: string, back: number, anchorPx: number): string {
  const space = getTextWidth(' ');
  const estimate = Math.round((anchorPx - getTextWidth(text) + back) / space);
  let best = '';
  let bestErr = Infinity;
  for (let n = Math.max(0, estimate - 1); n <= Math.max(0, estimate + 1); n++) {
    const padding = ' '.repeat(n);
    const err = Math.abs(getTextWidth(padding + text) - back - anchorPx);
    if (err < bestErr) [best, bestErr] = [padding, err];
  }
  return best;
}
