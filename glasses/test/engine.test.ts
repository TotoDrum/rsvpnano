import { describe, expect, it } from 'vitest';
import { focusIndex, layoutWord, textWidth, glyphWidth } from '../src/engine/orp';
import { DEFAULT_PACING, endsSentence, punctuationPausePercent, wordDurationMs } from '../src/engine/pacing';
import { ReadingSession } from '../src/engine/session';
import { MAX_TOKEN_CHARS, tokenize } from '../src/engine/tokenizer';

describe('tokenizer', () => {
  it('splits words and tracks paragraphs', () => {
    const t = tokenize('Hello world.\n\nSecond   paragraph here.\r\n\r\nThird');
    expect(t.words).toEqual(['Hello', 'world.', 'Second', 'paragraph', 'here.', 'Third']);
    expect(t.paragraphStarts).toEqual([0, 2, 5]);
  });

  it('joins standalone ellipses and keeps dashes as tokens', () => {
    const t = tokenize('Wait ... then — go');
    expect(t.words).toEqual(['Wait...', 'then', '-', 'go']);
  });

  it('splits very long tokens to fit one line', () => {
    const t = tokenize('pneumonoultramicroscopicsilicovolcanoconiosis');
    expect(t.words.length).toBeGreaterThan(1);
    for (const w of t.words) expect([...w].length).toBeLessThanOrEqual(MAX_TOKEN_CHARS);
    expect(t.words.join('').replace(/-/g, '')).toBe('pneumonoultramicroscopicsilicovolcanoconiosis');
  });
});

describe('pacing (port of ReadingLoop.cpp)', () => {
  const p = DEFAULT_PACING;

  it('uses 60000 / wpm as the base interval', () => {
    expect(wordDurationMs('the', 'cat', 300, p)).toBe(200);
  });

  it('adds sentence and comma pauses', () => {
    // 135% and 45% of the 200 ms punctuation delay
    expect(wordDurationMs('end.', 'Next', 300, p)).toBe(200 + 270);
    expect(wordDurationMs('so,', 'then', 300, p)).toBe(200 + 90);
    expect(punctuationPausePercent('really?', false)).toBe(150);
    expect(punctuationPausePercent('wait...', false)).toBe(110);
  });

  it('does not treat abbreviations as sentence ends', () => {
    expect(punctuationPausePercent('Dr.', false)).toBe(0);
    expect(punctuationPausePercent('e.g.', false)).toBe(0);
    expect(endsSentence('Mr.', 'Smith')).toBe(false);
    expect(endsSentence('done.', 'Then')).toBe(true);
  });

  it('slows down for long and complex words', () => {
    const short = wordDurationMs('cat', 'x', 300, p);
    const long = wordDurationMs('extraordinarily', 'x', 300, p);
    expect(long).toBeGreaterThan(short + 100);
    expect(wordDurationMs('ABC123', 'x', 300, p)).toBeGreaterThan(short);
  });
});

describe('ORP', () => {
  it('matches the firmware focus ordinal', () => {
    expect(focusIndex('a')).toBe(0);
    expect(focusIndex('read')).toBe(1);
    expect(focusIndex('reading')).toBe(2);
    expect(focusIndex('"Quote')).toBe(2); // leading punctuation is skipped when counting
    expect(focusIndex('internationally')).toBe(4);
  });

  it('pads words so the focus letter lands on the anchor', () => {
    const anchor = 12;
    for (const word of ['I', 'cat', 'reading', 'extraordinary']) {
      const { line } = layoutWord(word, anchor, 'orp');
      const pad = line.length - word.length;
      const idx = focusIndex(word);
      const focusCenter = pad * glyphWidth(' ') + textWidth(word.slice(0, idx)) + glyphWidth(word[idx]) / 2;
      expect(Math.abs(focusCenter - anchor)).toBeLessThanOrEqual(glyphWidth(' ') / 2 + 1e-9);
    }
  });
});

describe('session navigation', () => {
  const s = new ReadingSession(tokenize('One two. Three four five. Six.\n\nSeven eight.'));

  it('rewinds to the start of the sentence, then the previous one', () => {
    s.seekTo(4); // "five."
    s.rewindSentence();
    expect(s.current).toBe('Three');
    s.rewindSentence();
    expect(s.current).toBe('One');
  });

  it('moves forward by sentence across paragraphs', () => {
    s.seekTo(0);
    s.forwardSentence();
    expect(s.current).toBe('Three');
    s.forwardSentence();
    expect(s.current).toBe('Six.');
    s.forwardSentence();
    expect(s.current).toBe('Seven');
  });

  it('reports progress and context', () => {
    s.seekTo(s.length - 1);
    expect(s.progress).toBe(1);
    expect(s.atEnd).toBe(true);
    s.seekTo(3);
    const ctx = s.context(100);
    expect(ctx.before).toBe('One two. Three');
    expect(ctx.after).toBe('five. Six.');
  });
});
