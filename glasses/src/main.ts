import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { GlassesApp } from './glasses/app';
import { tokenize } from './engine/tokenizer';
import { mountPhoneUi } from './phone/ui';
import { Store } from './storage';
import './style.css';

const BRIDGE_TIMEOUT_MS = 3000;

async function connectBridge(): Promise<EvenAppBridge | null> {
  // Outside the Even App WebView there is no native handler: run in preview mode.
  const w = window as unknown as { flutter_inappwebview?: unknown };
  if (!w.flutter_inappwebview) return null;
  return Promise.race([
    waitForEvenAppBridge(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), BRIDGE_TIMEOUT_MS)),
  ]);
}

const SAMPLE_TITLE = 'Welcome to RSVP Nano';
const SAMPLE_TEXT = `Rapid Serial Visual Presentation, or RSVP, is a reading technique that displays text one word at a time in a fixed position. Instead of moving your eyes across lines and paragraphs, you keep your gaze locked on a single point while words flash in sequence.

Every word has a letter your brain naturally fixates on first, called the Optimal Recognition Point. RSVP Nano keeps that letter in the same place, so your eyes never have to move.

Tap the touchpad to pause. While paused, swipe to jump between sentences. While reading, swipe to change speed. Double-tap to return to the library.`;

async function boot(): Promise<void> {
  const bridge = await connectBridge();
  const store = new Store(bridge);
  await store.load();
  if (store.library.length === 0) {
    await store.addBook(SAMPLE_TITLE, SAMPLE_TEXT, tokenize(SAMPLE_TEXT).words.length);
  }
  const app = new GlassesApp(bridge, store);
  mountPhoneUi(document.getElementById('app')!, app, store, bridge !== null);
  await app.showLibrary();
}

void boot();
