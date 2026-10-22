// @vitest-environment jsdom
import { OsEventTypeList, type EvenAppBridge, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext';
import { GlassesApp, fitContext, statusWithBar } from '../src/glasses/app';
import { tokenize } from '../src/engine/tokenizer';
import { Store } from '../src/storage';

const CALL_MS = 80;

/** Minimal stand-in for the Even App bridge with BLE-like latency. */
function fakeBridge() {
  const kv = new Map<string, string>();
  const calls: { method: string; arg: any; at: number }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let handler: ((e: EvenHubEvent) => void) | null = null;
  const slow = <T>(method: string, arg: unknown, result: T) => {
    calls.push({ method, arg, at: Date.now() });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<T>((resolve) =>
      setTimeout(() => {
        inFlight--;
        resolve(result);
      }, CALL_MS),
    );
  };
  const bridge = {
    getLocalStorage: async (k: string) => kv.get(k) ?? '',
    setLocalStorage: async (k: string, v: string) => (kv.set(k, v), true),
    createStartUpPageContainer: (c: unknown) => slow('create', c, 0),
    rebuildPageContainer: (c: unknown) => slow('rebuild', c, true),
    textContainerUpgrade: (c: unknown) => slow('text', c, true),
    shutDownPageContainer: (m: number) => slow('shutdown', m, true),
    onEvenHubEvent: (cb: (e: EvenHubEvent) => void) => {
      handler = cb;
      return () => {};
    },
  };
  return {
    bridge: bridge as unknown as EvenAppBridge,
    calls,
    kv,
    get maxInFlight() {
      return maxInFlight;
    },
    emit: (e: EvenHubEvent) => handler?.(e),
  };
}

const TEXT = 'Alpha beta gamma. Delta epsilon zeta. Eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau.';

describe('GlassesApp with a fake bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  });
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const fake = fakeBridge();
    const store = new Store(fake.bridge);
    await store.load();
    const book = await store.addBook('Test book', TEXT, tokenize(TEXT).words.length);
    const app = new GlassesApp(fake.bridge, store);
    await app.showLibrary();
    await vi.advanceTimersByTimeAsync(200);
    return { fake, store, app, book };
  }

  it('creates the startup page once, then rebuilds', async () => {
    const { fake, app, book } = await setup();
    expect(fake.calls.filter((c) => c.method === 'create')).toHaveLength(1);
    const created = fake.calls[0].arg;
    expect(created.listObject[0].itemContainer.itemName[0]).toContain('Test book');
    // exactly one container captures events
    const capturing = [...(created.textObject ?? []), ...(created.listObject ?? [])].filter((c: any) => c.isEventCapture === 1);
    expect(capturing).toHaveLength(1);

    // Tap a list item (click arrives with eventType undefined and index 0 omitted).
    fake.emit({ listEvent: { containerName: 'library', currentSelectItemName: 'Test book  0%' } as any });
    await vi.advanceTimersByTimeAsync(500);
    expect(app.mode).toBe('reader');
    expect(app.book?.id).toBe(book.id);
    expect(fake.calls.some((c) => c.method === 'rebuild')).toBe(true);
  });

  it('plays with one BLE call in flight and drops stale words when too fast', async () => {
    const { fake, app, store } = await setup();
    await app.openBook(store.library[0].id);
    await vi.advanceTimersByTimeAsync(500);
    store.settings.wpm = 600; // 100 ms per word vs 80 ms per call
    fake.calls.length = 0;
    fake.emit({ textEvent: { containerName: 'word', eventType: undefined } as any }); // tap = play
    expect(app.playing).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.maxInFlight).toBe(1);
    expect(app.session!.index).toBeGreaterThan(10);
    const words = fake.calls.filter((c) => c.method === 'text' && c.arg.containerName === 'word');
    expect(words.length).toBeGreaterThan(5);
    // Every word frame keeps the guides and the padded word on line 2
    expect(words[0].arg.content.split('\n')).toHaveLength(3);
  });

  it('pauses at the end of the book and saves progress', async () => {
    const { fake, app, store, book } = await setup();
    await app.openBook(book.id);
    app.play();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.playing).toBe(false);
    expect(app.session!.atEnd).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(await store.progress(book.id)).toBe(app.session!.length - 1);
    const status = fake.calls.filter((c) => c.method === 'text' && c.arg.containerName === 'status').pop();
    expect(status?.arg.content).toContain('end');
  });

   it('clears context and status text when play starts', async () => {
     const { fake, app, book } = await setup();
     await app.openBook(book.id);
     await vi.advanceTimersByTimeAsync(500);
     // After openBook, context and status should have non-empty content
     const contextBefore = fake.calls.filter((c) => c.method === 'text' && c.arg.containerName === 'context');
     const statusBefore = fake.calls.filter((c) => c.method === 'text' && c.arg.containerName === 'status');
     expect(contextBefore[contextBefore.length - 1].arg.content).not.toBe('');
     expect(statusBefore[statusBefore.length - 1].arg.content).not.toBe('');

     fake.calls.length = 0;
     app.play();
     expect(app.playing).toBe(true);
     await vi.advanceTimersByTimeAsync(500);

     // play() clears overlays via rebuildPageContainer, which sends a fresh page
     const rebuildCalls = fake.calls.filter((c) => c.method === 'rebuild');
     expect(rebuildCalls.length).toBeGreaterThan(0);
     const lastRebuild = rebuildCalls[rebuildCalls.length - 1].arg;
     const textObjects: any[] = lastRebuild.textObject ?? [];
     const context = textObjects.find((t) => t.containerName === 'context');
     const status = textObjects.find((t) => t.containerName === 'status');
     expect(context).toBeDefined();
     expect(context!.content).toBe('');
     expect(status).toBeDefined();
     expect(status!.content).toBe('');
   });

  it('maps swipes to speed while playing and sentences while paused', async () => {
    const { fake, app, store, book } = await setup();
    await app.openBook(book.id);
    const start = store.settings.wpm;
    app.play();
    fake.emit({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } as any });
    expect(store.settings.wpm).toBe(start + 25);
    await vi.advanceTimersByTimeAsync(300);
    fake.emit({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } as any });
    expect(store.settings.wpm).toBe(start);

    app.pause();
    app.seekTo(0);
    await vi.advanceTimersByTimeAsync(300);
    fake.emit({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } as any });
    expect(app.session!.current).toBe('Delta');
    await vi.advanceTimersByTimeAsync(300);
    fake.emit({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } as any });
    expect(app.session!.current).toBe('Alpha');
  });

  it('double-tap goes back to the library, then exits from the root page', async () => {
    const { fake, app, book } = await setup();
    await app.openBook(book.id);
    fake.emit({ textEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } as any });
    await vi.advanceTimersByTimeAsync(500);
    expect(app.mode).toBe('library');
    fake.emit({ listEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } as any });
    await vi.advanceTimersByTimeAsync(200);
    expect(fake.calls.some((c) => c.method === 'shutdown' && c.arg === 1)).toBe(true);
    // Host clears the page for the exit dialog and sends FOREGROUND_ENTER: we redraw.
    const rebuildsBefore = fake.calls.filter((c) => c.method === 'rebuild').length;
    fake.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } as any });
    await vi.advanceTimersByTimeAsync(200);
    expect(fake.calls.filter((c) => c.method === 'rebuild').length).toBe(rebuildsBefore + 1);
  });

  it('stores long books in chunks and reads them back intact', async () => {
    const { store } = await setup();
    const long = 'word '.repeat(40_000).trim();
    const meta = await store.addBook('Long', long, 40_000);
    expect(meta.chunks).toBeGreaterThan(1);
    expect(await store.bookText(meta)).toBe(long);
  });
});

describe('paused context', () => {
  const words = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

  it('trims long context to three lines around the current word', () => {
    const text = fitContext(words(40, 'before'), 'current', words(40, 'after'));
    expect(measureTextWrap(text, 544).lineCount).toBeLessThanOrEqual(3);
    expect(text).toContain('[current]');
    expect(text).toContain('before39 [current] after0');
  });

  it('leaves short context untouched', () => {
    expect(fitContext('one two', 'three', 'four')).toBe('one two [three] four');
    expect(fitContext('', 'alone', '')).toBe('[alone]');
  });
});

describe('status progress bar', () => {
  const cells = (line: string) => [...line].filter((c) => c === '━' || c === '─').length;

  it('fills the status line without wrapping', () => {
    for (const [left, right] of [['100 wpm', 'paused'], ['600 wpm', 'end'], ['300 wpm', '']]) {
      const line = statusWithBar(left, 0.5, right);
      expect(getTextWidth(line)).toBeLessThanOrEqual(544);
      expect(544 - getTextWidth(line)).toBeLessThan(getTextWidth('━'));
      expect(line.startsWith(`${left}  `)).toBe(true);
      if (right) expect(line.endsWith(`  ${right}`)).toBe(true);
    }
  });

  it('fills in proportion to progress', () => {
    const empty = statusWithBar('300 wpm', 0, 'paused');
    const full = statusWithBar('300 wpm', 1, 'paused');
    const n = cells(empty);
    expect(n).toBeGreaterThan(10);
    expect(empty).not.toContain('━');
    expect(full).not.toContain('─');
    expect(cells(full)).toBe(n);
    const half = statusWithBar('300 wpm', 0.5, 'paused');
    expect([...half].filter((c) => c === '━').length).toBe(Math.round(n / 2));
  });
});
