// Glasses-side app: a library page (root) and the RSVP reader page.
//
// Controls (temple touchpad or R1 ring):
//   Library  tap: open book   double-tap: exit app
//   Reader   tap: play / pause
//            swipe while playing: speed up / slow down
//            swipe while paused: previous / next sentence
//            double-tap: save and return to the library
import { OsEventTypeList, type EvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { layoutWord } from '../engine/orp';
import { wordDurationMs } from '../engine/pacing';
import { ReadingSession } from '../engine/session';
import { tokenize } from '../engine/tokenizer';
import { WPM_STEP, clampWpm, type BookMeta, type Store } from '../storage';
import { GlassesDisplay, SCREEN_W, type Page } from './display';

const ANCHOR_PX = Math.round(SCREEN_W * 0.42);
const SWIPE_COOLDOWN_MS = 250;
const PROGRESS_SAVE_MS = 10_000;
const LEAD_IN_MS = 350;
const STATUS_FLASH_MS = 1500;
const CONTEXT_CHARS = 150;

type Mode = 'library' | 'reader';
type Listener = () => void;

export class GlassesApp {
  readonly display: GlassesDisplay;
  mode: Mode = 'library';
  book: BookMeta | null = null;
  session: ReadingSession | null = null;
  playing = false;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;
  private lastSwipe = Number.NEGATIVE_INFINITY;
  private lastSaved = 0;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private libraryProgress = new Map<string, number>();

  constructor(
    private readonly bridge: EvenAppBridge | null,
    private readonly store: Store,
  ) {
    this.display = new GlassesDisplay(bridge);
    bridge?.onEvenHubEvent((e) => this.onEvent(e));
  }

  /** Notified on any state change, for the phone UI. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- library

  async showLibrary(): Promise<void> {
    this.stop();
    await this.saveProgress();
    this.mode = 'library';
    this.session = null;
    this.book = null;
    for (const b of this.store.library) this.libraryProgress.set(b.id, await this.store.progress(b.id));
    this.display.show(this.libraryPage());
    this.changed();
  }

  private libraryPage(): Page {
    const books = this.store.library.slice(0, 20);
    if (books.length === 0) {
      return [
        {
          kind: 'text', id: 1, name: 'empty', x: 24, y: 96, w: 528, h: 100, capture: true,
          content: 'RSVP Nano\n\nAdd a book from the phone app to start reading.',
        },
      ];
    }
    return [
      { kind: 'text', id: 1, name: 'title', x: 16, y: 4, w: 544, h: 36, content: 'RSVP Nano  -  Library', brightness: 2 },
      {
        kind: 'list', id: 2, name: 'library', x: 8, y: 44, w: 560, h: 240, capture: true, selected: 0,
        items: books.map((b) => {
          const pct = b.wordCount > 1 ? Math.round(((this.libraryProgress.get(b.id) ?? 0) / (b.wordCount - 1)) * 100) : 0;
          return `${b.title.slice(0, 44)}  ${pct}%`;
        }),
      },
    ];
  }

  // ---------------------------------------------------------------- reader

  async openBook(id: string): Promise<void> {
    const meta = this.store.library.find((b) => b.id === id);
    if (!meta) return;
    this.stop();
    if (this.book) await this.saveProgress();
    const text = await this.store.bookText(meta);
    const session = new ReadingSession(tokenize(text));
    if (session.length === 0) return;
    session.seekTo(await this.store.progress(id));
    this.book = meta;
    this.session = session;
    this.mode = 'reader';
    this.display.show(this.readerPage());
    this.renderWord();
    this.renderPaused();
    this.changed();
  }

  private readerPage(): Page {
    const s = this.store.settings;
    return [
      { kind: 'text', id: 1, name: 'context', x: 16, y: 0, w: 544, h: 92, content: '', brightness: 2 },
      { kind: 'text', id: 2, name: 'word', x: 0, y: 96, w: SCREEN_W, h: 120, content: '', capture: true, brightness: s.wordBrightness },
      { kind: 'text', id: 3, name: 'status', x: 16, y: 250, w: 544, h: 36, content: '', brightness: 2 },
    ];
  }

  private renderWord(): void {
    if (!this.session) return;
    const s = this.store.settings;
    const { line, guide } = layoutWord(this.session.current, ANCHOR_PX / s.fontScale, s.alignment);
    const content = s.showGuides ? `${guide}\n${line}\n${guide}` : `\n${line}`;
    this.display.setText('word', content, s.wordBrightness);
  }

  private statusLine(extra = ''): string {
    if (!this.session) return '';
    const pct = Math.round(this.session.progress * 100);
    const state = this.session.atEnd && !this.playing ? 'end' : this.playing ? '' : 'paused';
    return [`${this.store.settings.wpm} wpm`, `${pct}%`, state, extra].filter(Boolean).join('   ');
  }

  private renderPaused(): void {
    if (!this.session) return;
    const { before, after } = this.session.context(CONTEXT_CHARS);
    this.display.setText('context', `${before} [${this.session.current}] ${after}`.trim());
    this.display.setText('status', this.statusLine());
  }

  private flashStatus(): void {
    this.display.setText('status', this.statusLine());
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      if (this.playing) this.display.setText('status', '');
    }, STATUS_FLASH_MS);
  }

  play(): void {
    if (!this.session || this.playing) return;
    if (this.session.atEnd) this.session.seekTo(0);
    this.playing = true;
    this.display.setText('context', '');
    this.display.setText('status', '');
    this.renderWord();
    this.nextAt = performance.now() + LEAD_IN_MS;
    this.schedule();
    this.changed();
  }

  pause(): void {
    if (!this.playing) return;
    this.stop();
    this.renderPaused();
    void this.saveProgress();
    this.changed();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private stop(): void {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.playing || !this.session) return;
    const s = this.store.settings;
    // Drift-corrected: each word's deadline is computed from the previous deadline.
    this.nextAt += wordDurationMs(this.session.current, this.session.next, s.wpm, s.pacing);
    this.timer = setTimeout(() => this.tick(), Math.max(0, this.nextAt - performance.now()));
  }

  private tick(): void {
    if (!this.playing || !this.session) return;
    if (!this.session.advance()) {
      this.pause();
      return;
    }
    // If the WebView stalled (backgrounded, GC), don't fire a burst of catch-up words.
    if (performance.now() - this.nextAt > 1000) this.nextAt = performance.now();
    this.renderWord();
    this.schedule();
    if (performance.now() - this.lastSaved > PROGRESS_SAVE_MS) void this.saveProgress();
    this.changed();
  }

  adjustWpm(direction: 1 | -1): void {
    const s = this.store.settings;
    s.wpm = clampWpm(s.wpm + direction * WPM_STEP);
    void this.store.saveSettings();
    if (this.playing) this.flashStatus();
    else this.renderPaused();
    this.changed();
  }

  stepSentence(direction: 1 | -1): void {
    if (!this.session) return;
    if (direction < 0) this.session.rewindSentence();
    else this.session.forwardSentence();
    this.renderWord();
    this.renderPaused();
    this.changed();
  }

  seekTo(index: number): void {
    if (!this.session) return;
    this.session.seekTo(index);
    this.renderWord();
    if (!this.playing) this.renderPaused();
    this.changed();
  }

  /** Call after settings change on the phone so the glasses reflect them. */
  refresh(): void {
    if (this.mode === 'reader' && this.session) {
      this.renderWord();
      if (!this.playing) this.renderPaused();
    } else if (this.mode === 'library') {
      this.display.show(this.libraryPage());
    }
    this.changed();
  }

  private async saveProgress(): Promise<void> {
    if (!this.book || !this.session) return;
    this.lastSaved = performance.now();
    this.libraryProgress.set(this.book.id, this.session.index);
    await this.store.saveProgress(this.book.id, this.session.index);
  }

  // ---------------------------------------------------------------- input

  private onEvent(event: EvenHubEvent): void {
    const sys = event.sysEvent;
    const source = event.listEvent ?? event.textEvent ?? sys;
    if (!source) return;
    const type = source.eventType;

    if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      // After the exit dialog the host clears our page; draw it again.
      this.display.redraw();
      return;
    }
    if (type === OsEventTypeList.FOREGROUND_EXIT_EVENT || type === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      this.pause();
      return;
    }
    if (type === OsEventTypeList.SYSTEM_EXIT_EVENT) {
      this.pause();
      void this.saveProgress();
      return;
    }
    if (type === OsEventTypeList.IMU_DATA_REPORT || type === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return;

    // CLICK_EVENT (0) often arrives as undefined after SDK normalisation.
    const isClick = type === OsEventTypeList.CLICK_EVENT || type === undefined;
    const isDouble = type === OsEventTypeList.DOUBLE_CLICK_EVENT;
    const isUp = type === OsEventTypeList.SCROLL_TOP_EVENT;
    const isDown = type === OsEventTypeList.SCROLL_BOTTOM_EVENT;

    if (this.mode === 'library') {
      if (isDouble) {
        void this.bridge?.shutDownPageContainer(1);
        return;
      }
      if (isClick && event.listEvent) {
        const books = this.store.library.slice(0, 20);
        let index = event.listEvent.currentSelectItemIndex;
        if (index === undefined) {
          const name = event.listEvent.currentSelectItemName;
          index = Math.max(0, this.libraryPage().flatMap((b) => (b.kind === 'list' ? b.items : [])).indexOf(name ?? ''));
        }
        const book = books[index];
        if (book) void this.openBook(book.id);
      }
      return;
    }

    // Reader
    if (isDouble) {
      void this.showLibrary();
      return;
    }
    if (isClick) {
      this.toggle();
      return;
    }
    if (isUp || isDown) {
      const now = performance.now();
      if (now - this.lastSwipe < SWIPE_COOLDOWN_MS) return;
      this.lastSwipe = now;
      if (this.playing) this.adjustWpm(isDown ? 1 : -1);
      else this.stepSentence(isDown ? 1 : -1);
    }
  }
}
