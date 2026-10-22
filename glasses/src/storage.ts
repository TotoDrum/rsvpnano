// Persistent library, progress and settings.
// Even Hub WebViews lose browser localStorage on restart, so everything goes
// through the bridge's key-value store. Book text is split into chunks to stay
// well under any per-value limit.
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { DEFAULT_PACING, type PacingSettings } from './engine/pacing';

export interface Settings {
  wpm: number;
  pacing: PacingSettings;
  alignment: 'orp' | 'center';
  showGuides: boolean;
  wordBrightness: number;
}

export const WPM_MIN = 100;
export const WPM_MAX = 600;
export const WPM_STEP = 25;

export const DEFAULT_SETTINGS: Settings = {
  wpm: 300,
  pacing: { ...DEFAULT_PACING },
  alignment: 'orp',
  showGuides: true,
  wordBrightness: 4,
};

export interface BookMeta {
  id: string;
  title: string;
  wordCount: number;
  chunks: number;
  addedAt: number;
}

const CHUNK_CHARS = 60_000;
const K = {
  settings: 'rsvp.settings',
  library: 'rsvp.library',
  chunk: (id: string, n: number) => `rsvp.book.${id}.${n}`,
  progress: (id: string) => `rsvp.progress.${id}`,
  lastBook: 'rsvp.lastBook',
};

interface KeyValue {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
}

function backend(bridge: EvenAppBridge | null): KeyValue {
  if (bridge) {
    return {
      get: async (k) => (await bridge.getLocalStorage(k)) ?? '',
      set: async (k, v) => {
        const ok = await bridge.setLocalStorage(k, v);
        if (!ok) throw new Error(`Could not save ${k}`);
      },
    };
  }
  return {
    get: async (k) => localStorage.getItem(k) ?? '',
    set: async (k, v) => localStorage.setItem(k, v),
  };
}

function parse<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class Store {
  private kv: KeyValue;
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  library: BookMeta[] = [];
  lastBook = '';

  constructor(bridge: EvenAppBridge | null) {
    this.kv = backend(bridge);
  }

  async load(): Promise<void> {
    const saved = parse<Partial<Settings>>(await this.kv.get(K.settings), {});
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      pacing: { ...DEFAULT_PACING, ...(saved.pacing ?? {}) },
    };
    this.settings.wpm = clampWpm(this.settings.wpm);
    this.library = parse<BookMeta[]>(await this.kv.get(K.library), []);
    this.lastBook = await this.kv.get(K.lastBook);
  }

  async saveSettings(): Promise<void> {
    await this.kv.set(K.settings, JSON.stringify(this.settings));
  }

  async addBook(title: string, text: string, wordCount: number): Promise<BookMeta> {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const chunks = Math.max(1, Math.ceil(text.length / CHUNK_CHARS));
    for (let n = 0; n < chunks; n++) {
      await this.kv.set(K.chunk(id, n), text.slice(n * CHUNK_CHARS, (n + 1) * CHUNK_CHARS));
    }
    const meta: BookMeta = { id, title: title.trim() || 'Untitled', wordCount, chunks, addedAt: Date.now() };
    this.library.unshift(meta);
    await this.kv.set(K.library, JSON.stringify(this.library));
    return meta;
  }

  async removeBook(id: string): Promise<void> {
    const meta = this.library.find((b) => b.id === id);
    if (!meta) return;
    this.library = this.library.filter((b) => b.id !== id);
    await this.kv.set(K.library, JSON.stringify(this.library));
    // There is no delete call on the bridge; empty strings mean "absent".
    for (let n = 0; n < meta.chunks; n++) await this.kv.set(K.chunk(id, n), '');
    await this.kv.set(K.progress(id), '');
  }

  async bookText(meta: BookMeta): Promise<string> {
    const parts: string[] = [];
    for (let n = 0; n < meta.chunks; n++) parts.push(await this.kv.get(K.chunk(meta.id, n)));
    return parts.join('');
  }

  async progress(id: string): Promise<number> {
    return Number.parseInt(await this.kv.get(K.progress(id)), 10) || 0;
  }

  async saveProgress(id: string, wordIndex: number): Promise<void> {
    await this.kv.set(K.progress(id), String(wordIndex));
    if (this.lastBook !== id) {
      this.lastBook = id;
      await this.kv.set(K.lastBook, id);
    }
  }
}

export function clampWpm(wpm: number): number {
  return Math.max(WPM_MIN, Math.min(WPM_MAX, Math.round(wpm / WPM_STEP) * WPM_STEP || DEFAULT_SETTINGS.wpm));
}
