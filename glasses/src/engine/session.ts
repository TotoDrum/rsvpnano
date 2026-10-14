// Reading position and navigation, modelled on ReadingLoop's seek helpers.
import { endsSentence } from './pacing';
import type { TokenizedText } from './tokenizer';

export class ReadingSession {
  index = 0;

  constructor(readonly text: TokenizedText) {}

  get words(): string[] {
    return this.text.words;
  }

  get length(): number {
    return this.text.words.length;
  }

  get current(): string {
    return this.words[this.index] ?? '';
  }

  get next(): string | undefined {
    return this.words[this.index + 1];
  }

  get atEnd(): boolean {
    return this.index >= this.length - 1;
  }

  get progress(): number {
    return this.length <= 1 ? 1 : this.index / (this.length - 1);
  }

  seekTo(index: number): void {
    this.index = Math.max(0, Math.min(this.length - 1, Math.floor(index)));
  }

  advance(): boolean {
    if (this.atEnd) return false;
    this.index++;
    return true;
  }

  private isSentenceStart(i: number): boolean {
    if (i <= 0) return true;
    if (this.text.paragraphStarts.includes(i)) return true;
    return endsSentence(this.words[i - 1], this.words[i]);
  }

  private sentenceStartAtOrBefore(i: number): number {
    while (i > 0 && !this.isSentenceStart(i)) i--;
    return i;
  }

  /** Jump to the start of the current sentence, or the previous one when already there. */
  rewindSentence(): void {
    let start = this.sentenceStartAtOrBefore(this.index);
    if (start === this.index && start > 0) start = this.sentenceStartAtOrBefore(start - 1);
    this.index = start;
  }

  forwardSentence(): void {
    let i = this.index + 1;
    while (i < this.length && !this.isSentenceStart(i)) i++;
    this.seekTo(i);
  }

  paragraphBounds(i = this.index): [number, number] {
    const starts = this.text.paragraphStarts;
    let p = 0;
    while (p + 1 < starts.length && starts[p + 1] <= i) p++;
    const start = starts[p] ?? 0;
    const end = (starts[p + 1] ?? this.length) - 1;
    return [start, end];
  }

  /** Words around the current one within the paragraph, capped by character budget. */
  context(maxChars: number): { before: string; after: string } {
    const [start, end] = this.paragraphBounds();
    const before: string[] = [];
    let used = 0;
    for (let i = this.index - 1; i >= start && used < maxChars / 2; i--) {
      before.unshift(this.words[i]);
      used += this.words[i].length + 1;
    }
    const after: string[] = [];
    used = 0;
    for (let i = this.index + 1; i <= end && used < maxChars / 2; i++) {
      after.push(this.words[i]);
      used += this.words[i].length + 1;
    }
    return { before: before.join(' '), after: after.join(' ') };
  }
}
