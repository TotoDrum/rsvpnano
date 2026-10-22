# RSVP Nano G2: Even Hub compliance to-do

Changes needed to bring the RSVP Nano G2 app (`glasses/` in the `even-g2` branch of
`TotoDrum/rsvpnano`) in line with Even Realities' design guidelines and App Submission and QA
requirements before publishing on Even Hub.

## Context

- **What the app is:** an Even Hub web app (Vite + TypeScript) that ports the RSVP Nano ESP32 speed
  reader to Even Realities G2 glasses. It shows one word at a time on the lenses, anchored on the
  word's focus letter (ORP).
- **Two halves:**
  - Phone page: library, file import, settings, live lens preview. Code in `src/phone/ui.ts`,
    `src/style.css`.
  - Glasses pages: library list and reader. Code in `src/glasses/app.ts`, `src/glasses/display.ts`.
- **Engine:** `src/engine/` (pacing, ORP, tokenizer, session), ported from the firmware. Covered by
  tests in `test/`.
- **Commands** (from `glasses/`): `npm run dev`, `npm test`, `npm run pack`.
- **Manifest:** `app.json`, with `package_id` `io.github.totodrum.rsvpnanog2` and name `RSVP Nano`.

Sources:
- UI/UX Design Guidelines: https://hub.evenrealities.com/docs/build/design-guidelines
- App Submission and QA: https://hub.evenrealities.com/docs/ship/app-submission
- Official skills repo (design-guidelines, font-measurement):
  https://github.com/even-realities/everything-evenhub
- Figma guidelines (not machine-readable, check manually):
  https://www.figma.com/design/X82y5uJvqMH95jgOfmV34j/Even-Realities---Software-Design-Guidelines--Public-?node-id=2922-80782

---

## Must fix before submitting

### 1. Phone page: switch to the Even app design system

**Problem:** the phone page uses a green accent (`#5cf28a`). Even's rule: glasses-display green
(`#3CFA44`) is for the G2 display only, never phone-side UI.

**Files:** `src/style.css`, `src/phone/ui.ts`

**Tasks:**
- [ ] Replace the color tokens in `src/style.css` with Even's:

  | Token | Light | Dark | Use |
  | --- | --- | --- | --- |
  | `--color-text` | `#232323` | `#FFFFFF` | Primary text |
  | `--color-text-dim` | `#7B7B7B` | `#8A8A8A` | Secondary text, captions |
  | `--color-bg` | `#FFFFFF` | `#111111` | Page background |
  | `--color-surface` | `#EEEEEE` | `#1A1A1A` | Cards, rows |
  | `--color-input-bg` | `rgba(35,35,35,0.08)` | `rgba(255,255,255,0.08)` | Inputs, search |
  | `--color-accent` | `#FEF991` | `#FEF991` | Buttons, highlights only |
  | `--color-text-on-accent` | `#FFFFFF` | `#FFFFFF` | Text on accent |

  - Even yellow `#FEF991` is for accents only, never a page background.
  - White text on `#FEF991` has poor contrast. Check the Figma file for how Even's own buttons
    handle this before copying the token as-is.
- [ ] Add light mode via `@media (prefers-color-scheme: light)`. The page is dark-only today.
- [ ] Apply the type scale. Font: FK Grotesk Neue if licensed, otherwise system sans.

  | Style | Size | Weight | Letter-spacing |
  | --- | --- | --- | --- |
  | Display | 34 px | 700 | -0.02em |
  | Title | 24 px | 600 | -0.02em |
  | Subtitle | 18 px | 500 | -0.01em |
  | Body | 16 px | 400 | -0.01em |
  | Caption | 13 px | 400 | 0 |
  | Label | 11 px | 500 | 0.04em, uppercase |

- [ ] Spacing on a 4/8 px grid (`4 8 12 16 24 32 48 64`): card padding 16, section spacing 24 to 32,
  screen edge padding 20 (currently 16).
- [ ] Range sliders and the checkbox use `accent-color: var(--accent)`; update to the new accent.
- [ ] Keep the lens preview green: it depicts the glasses display, which is allowed.

### 2. Store icon: 1-bit, 2×2 blocks

**Problem:** `public/icon.png` is a placeholder that uses grey pixels, so it fails portal validation.

**Rules (enforced by the Developer Portal's 24×24 editor):**
- 24×24 px, 1-bit monochrome: every pixel fully on or off, no greys or anti-aliasing.
- Every lit pixel must belong to a 2×2 block of lit pixels. Single pixels and 1 px lines fail.
  Effective design grid: 12×12.
- Fill the canvas edge to edge, no padding.
- Flat solid shapes, strokes at least 2 px, recognizable from silhouette alone.
- No gradients, shadows, outlines or fine detail.
- Both a foreground and a background asset are required, each monochrome or greyscale. Color
  assets are rejected.
- Illegible icons get rejected.

**Design direction (Thomas's idea):** "RS" stacked above "VP", with horizontal lines at the top and
bottom. On the 12×12 grid:
- Row 0: top line, full width.
- Row 1: gap.
- Rows 2 to 5: R and S, each 3 blocks wide, 1-block gap between them.
- Row 6: gap.
- Rows 7 to 10: V and P, same layout as R and S.
- Row 11: bottom line, full width.

**Caution:** the guidelines list text as detail to avoid. Letters must be bold and chunky enough to
read at 24×24 on the green display. Test in the simulator with glow enabled.

**Tasks:**
- [ ] Design the 12×12 block grid.
- [ ] Draw it in the portal editor.
- [ ] Export `public/icon.png` as a pure 1-bit 24×24 PNG.
- [ ] Prepare the background asset.

### 3. Locked-phone operation

**Problem:** reviewers test with the phone locked and the Even App backgrounded, using a Beta
build. QR sideloading cannot reproduce this. Word timing uses `setTimeout` in the WebView
(`GlassesApp.schedule` in `src/glasses/app.ts`), which may be throttled or suspended when the phone
locks. Reading with the phone in a pocket is the core use case.

**Tasks:**
- [ ] Install as a Beta build.
- [ ] Start a book, lock the phone for 5 minutes, and confirm words keep advancing at the set speed.
- [ ] Confirm tap, swipe and double-tap still respond while locked.
- [ ] After 2 minutes idle, confirm the app still responds: no freeze, loop or crash.
- [ ] Unlock, use another app, re-lock: the glasses session must continue.
- [ ] If timing degrades while locked, investigate the SDK's background keep-alive and the
  `background-state` skill in the everything-evenhub repo before redesigning.

### 4. Exit and lifecycle

**Current state:** double-tap on the library (root page) calls `shutDownPageContainer(1)`, which is
correct. Mode `0` and custom exit dialogs are not allowed on the root page.

**Tasks:**
- [ ] Verify on device that the phone-side WebView closes automatically after exit is confirmed.
  Lingering WebViews are rejected.
- [ ] After exiting, launch Conversate or Navigate and confirm they start without a glasses restart.
- [ ] Verify the empty-library page (root page when no books exist) also exits on double-tap.

### 5. Store listing and paperwork

**Tasks:**
- [ ] **Release notes:** 1 to 3 lines per supported language, describing what the app does.
  "Initial release" is not accepted.
- [ ] **Privacy policy:** no permissions are requested, but publish a short policy stating that
  books, progress and settings stay on the phone and nothing is sent to any server.
- [ ] **Screenshots:** capture with the simulator's screenshot function. They must match what the
  app renders on device.
- [ ] **Display name:** the store name must match `app.json` `name` and the name shown on the
  glasses ("RSVP Nano").
- [ ] **Naming approval:** "impersonating existing apps" is a rejection reason. Get the original
  RSVP Nano author's (Ionut Decebal) approval to publish under the name, or rename.
- [ ] **Version:** stay at `0.1.0` for the first submission. Every resubmission needs a higher
  version and a non-empty changelog. Released builds are immutable.
- [ ] Run `npx evenhub pack app.json dist -o rsvpnano.ehpk -c` to validate the manifest and check
  package ID availability.

**Listing copy already chosen:**
- Tagline (max 50 characters): `Read faster, one word at a time on your G2.`
- Description: see the draft in the project notes. It credits the original open-source project.

---

## Strongly recommended

### 6. Pixel-accurate text measurement with `@evenrealities/pretext`

**Problem:** focus letter alignment uses an estimated glyph width table (`src/engine/orp.ts`) plus
a user-facing "Font width calibration" slider. Even publishes an official measurement library that
matches the firmware's LVGL font exactly.

**Library API:**
- `getTextWidth(text): number`: single-line pixel width, with kerning.
- `measureTextWrap(text, maxWidth)`: returns `{ lineCount, height, lineWidths }`.
- `pxTruncate(text, maxPx)`: truncates to a pixel budget, appending `...`.
- `getAdvW(cp)`: raw advance width of a code point, in 1/16 px.

**Tasks:**
- [ ] `npm install @evenrealities/pretext`
- [ ] In `layoutWord` (`src/engine/orp.ts`), replace `textWidth` and `glyphWidth` with pixel widths
  from `getTextWidth`. Compute leading padding as
  `round((anchorPx - widthBeforeFocus - focusWidth / 2) / spaceWidth)`, where
  `spaceWidth = getTextWidth(' ')`. Guide tick padding works the same way.
- [ ] Remove `fontScale` from `Settings` (`src/storage.ts`), the calibration slider and hint from
  `src/phone/ui.ts`, and its mention in both READMEs.
- [ ] Use `pxTruncate` for library list titles in `libraryPage()` instead of `.slice(0, 44)`. The
  budget is the list width minus 12 px item padding per side, minus the width of the `  42%` suffix.
- [ ] Update `test/engine.test.ts`: assert the focus letter center lands within half a space width
  of the anchor using pretext measurements.
- [ ] Possible residual error: padding is quantized to whole spaces, so alignment is accurate to
  about half a space width. Acceptable.

### 7. Container sizes on the 27 px line grid

Fixed metrics: text line height 27 px, list item height 40 px, list item horizontal padding 12 px
per side. Canvas 576×288.

**Tasks:**
- [ ] Reader page (`readerPage()` in `src/glasses/app.ts`), with `paddingLength` 0:
  - `context`: 3 lines, height 81.
  - `word`: 3 lines (guide, word, guide), height 81, vertically centered.
  - `status`: 1 line, height 27, at the bottom.
  - Suggested y positions: context 0, word 103, status 261.
- [ ] Library page: list height = items × 40 + 2 × padding, capped to fit under the title.
- [ ] Size the paused context text with `measureTextWrap` so it never exceeds 3 lines. Overflow
  makes the firmware scroll the container.
- [ ] Update the phone preview CSS (`.box` in `src/style.css`) to `line-height: 27px` so the
  preview matches.

---

## Nice to have

### 8. Progress bar in the paused status line

- [ ] Replace `42%` with Even's documented progress pattern, sized with `getTextWidth`. Example:
  `300 wpm  ━━━━━━──────────  paused`.
- [ ] Confirm `━` and `─` render on device; characters missing from the font are silently skipped.

---

## Already compliant (no action needed)

- [x] `package_id` format: lowercase, no hyphens, at least two segments.
- [x] `name` of 20 characters or fewer, without "Even".
- [x] `edition` `202601`, `min_sdk_version` at or above `0.0.14`.
- [x] No unused permissions declared.
- [x] Exactly one event-capturing container per page.
- [x] `containerName` values of 16 characters or fewer, unique per page.
- [x] Root-page double-tap calls `shutDownPageContainer(1)`.
- [x] First run is never a black screen: a welcome book is seeded, and the empty library shows
  instructions.
- [x] Settings, books and progress persist through `bridge.setLocalStorage`, not browser storage.
- [x] Every gesture has visible feedback (word change, status flash on speed change, sentence jump).
- [x] No secrets or API keys in the bundle.

## Pre-submission checklist (from Even)

1. `npx evenhub pack app.json dist -o rsvpnano.ehpk -c` validates.
2. Install as a Beta build, lock the phone for 5 minutes, confirm it stays alive and responsive.
3. Double-tap on the root page: the system exit dialog appears, and the WebView closes on confirm.
4. Launch Conversate afterwards: it starts without restarting the glasses.
5. Privacy policy covers every permission in `app.json` (none currently).
