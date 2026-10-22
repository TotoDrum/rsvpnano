# RSVP Nano for Even Realities G2

A port of the RSVP Nano reader to Even Realities G2 smart glasses, built as an
Even Hub app. Words flash one at a time in the lens, anchored on their focus
letter, with the same timing model as the ESP32 firmware.

## What carries over from the firmware

| Firmware | Glasses port |
| --- | --- |
| `src/reader/ReadingLoop.cpp` pacing (long words, complexity, punctuation, abbreviations) | `src/engine/pacing.ts`, same constants |
| `ReaderScreen::focusOffset` / `focusOrdinal` (ORP) | `src/engine/orp.ts` |
| `src/text/RsvpTokenizer.h` (ellipsis joining, dash tokens, paragraphs) | `src/engine/tokenizer.ts`, simplified |
| Sentence rewind, paragraph bounds | `src/engine/session.ts` |
| SD card library, `.rstate` progress | Even Hub bridge storage, chunked |
| Companion conversion (EPUB, TXT, MD, HTML, XHTML) | `src/import/convert.ts`, runs on the phone |

Not ported: page reading mode, RTL and CJK shaping, custom fonts and themes,
focus timers, RSS, screensavers, OTA. The G2 has one built-in font and no
alignment control, so those don't map cleanly.

## Controls

| Where | Gesture | Action |
| --- | --- | --- |
| Library | Swipe | Move selection |
| Library | Tap | Open book at saved position |
| Library | Double-tap | Exit app |
| Reader | Tap | Play / pause |
| Reader, playing | Swipe down / up | Faster / slower (25 wpm steps, 100 to 600) |
| Reader, paused | Swipe down / up | Next / previous sentence |
| Reader | Double-tap | Save progress, back to library |

When paused, the top of the lens shows the surrounding text with the current
word in brackets, and the bottom shows speed and progress.

The phone page mirrors the lens live and has the library, import, reading
settings and the same playback controls.

## Hardware limits that shaped the design

- **Speed cap 600 wpm.** Each `textContainerUpgrade` takes about 80 ms over
  BLE. Updates are serialized with one call in flight; if words come faster
  than the link, stale words are dropped instead of queuing up.
- **ORP alignment is quantized to spaces.** The firmware font is proportional
  with no centering, so the word is left-padded with spaces. Widths come from
  `@evenrealities/pretext`, Even's copy of the firmware font metrics, so the
  focus letter lands within half a space (about 2 px) of the guide ticks.
- **Storage.** Browser storage is wiped when the Even App restarts, so books,
  progress and settings go through `bridge.setLocalStorage`, with book text
  split into 60k character chunks.

## Develop

```bash
cd glasses
npm install
npm run dev            # Vite on 0.0.0.0:5173
npm run qr             # QR code for the Even App (use your LAN IP)
npm run sim            # Even Hub simulator, if installed
npm test               # engine + app tests (fake bridge)
npm run pack           # builds dist/ and rsvpnano.ehpk
```

Opening the page in a normal browser runs **preview mode**: no bridge, browser
storage, and the lens preview shows exactly what would be sent to the glasses.
