// Phone-side companion page: library management, file import, settings and a
// live preview of what the glasses are showing.
import { tokenize } from '../engine/tokenizer';
import { SCREEN_H, SCREEN_W, type Page } from '../glasses/display';
import type { GlassesApp } from '../glasses/app';
import { importFile } from '../import/convert';
import { WPM_MAX, WPM_MIN, WPM_STEP, type Store } from '../storage';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function mountPhoneUi(root: HTMLElement, app: GlassesApp, store: Store, connected: boolean): void {
  root.innerHTML = `
    <header>
      <h1>RSVP Nano <span>for Even G2</span></h1>
      <p class="conn ${connected ? 'on' : 'off'}">${connected ? 'Connected to Even App' : 'Preview mode (no glasses bridge)'}</p>
    </header>

    <section class="card">
      <h2>On your glasses</h2>
      <div class="lens" id="lens"><div class="lens-inner" id="lens-inner"></div></div>
      <div id="reader-controls" class="controls" hidden>
        <div class="now" id="now"></div>
        <input type="range" id="seek" min="0" max="0" value="0" aria-label="Position">
        <div class="row">
          <button id="prev" title="Previous sentence">Prev</button>
          <button id="toggle" class="primary">Play</button>
          <button id="next" title="Next sentence">Next</button>
        </div>
        <div class="row">
          <button id="slower">- ${WPM_STEP}</button>
          <span id="wpm-label"></span>
          <button id="faster">+ ${WPM_STEP}</button>
        </div>
        <button id="back" class="ghost">Back to library</button>
      </div>
    </section>

    <section class="card">
      <h2>Library</h2>
      <ul id="library" class="library"></ul>
      <label class="file">
        <input type="file" id="file" accept=".epub,.txt,.md,.markdown,.html,.htm,.xhtml,text/plain" hidden>
        <span>Import EPUB, TXT, Markdown or HTML</span>
      </label>
      <details>
        <summary>Paste text</summary>
        <input id="paste-title" placeholder="Title">
        <textarea id="paste-text" rows="6" placeholder="Paste an article or notes"></textarea>
        <button id="paste-add" class="primary">Add to library</button>
      </details>
      <p id="msg" class="msg" role="status"></p>
    </section>

    <section class="card settings">
      <h2>Reading</h2>
      <label>Speed <output id="o-wpm"></output>
        <input type="range" id="s-wpm" min="${WPM_MIN}" max="${WPM_MAX}" step="${WPM_STEP}"></label>
      <label>Long word delay <output id="o-long"></output>
        <input type="range" id="s-long" min="0" max="600" step="50"></label>
      <label>Complex word delay <output id="o-complex"></output>
        <input type="range" id="s-complex" min="0" max="600" step="50"></label>
      <label>Punctuation delay <output id="o-punct"></output>
        <input type="range" id="s-punct" min="0" max="600" step="50"></label>
      <h2>Display</h2>
      <label>Alignment
        <select id="s-align"><option value="orp">Focus letter (ORP)</option><option value="center">Centered word</option></select></label>
      <label class="check"><input type="checkbox" id="s-guides"> Focus guides</label>
      <label>Word brightness <output id="o-bright"></output>
        <input type="range" id="s-bright" min="1" max="4" step="1"></label>
      <label>Font width calibration <output id="o-scale"></output>
        <input type="range" id="s-scale" min="12" max="30" step="1"></label>
      <p class="hint">If the focus letter drifts left or right of the guides on your lenses, nudge the calibration until it sits under them.</p>
    </section>

    <section class="card help">
      <h2>Controls</h2>
      <dl>
        <dt>Tap</dt><dd>Play or pause</dd>
        <dt>Swipe (reading)</dt><dd>Faster or slower</dd>
        <dt>Swipe (paused)</dt><dd>Next or previous sentence</dd>
        <dt>Double-tap</dt><dd>Back to library, or exit from the library</dd>
      </dl>
    </section>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const msg = (text: string, error = false) => {
    const el = $('msg');
    el.textContent = text;
    el.classList.toggle('error', error);
  };

  // ---------------------------------------------------------------- preview
  const lens = $('lens');
  const lensInner = $('lens-inner');
  const fitLens = () => {
    const scale = lens.clientWidth / SCREEN_W;
    lensInner.style.transform = `scale(${scale})`;
    lens.style.height = `${SCREEN_H * scale}px`;
  };
  new ResizeObserver(fitLens).observe(lens);

  const renderLens = (page: Page) => {
    lensInner.innerHTML = page
      .map((b) => {
        const style = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
        if (b.kind === 'list') {
          return `<ul class="box list" style="${style}">${b.items
            .map((it, i) => `<li class="${i === b.selected ? 'sel' : ''}">${esc(it)}</li>`)
            .join('')}</ul>`;
        }
        const level = b.brightness ?? 4;
        return `<pre class="box text b${level}" style="${style}">${esc(b.content)}</pre>`;
      })
      .join('');
  };
  app.display.subscribe(renderLens);

  // ---------------------------------------------------------------- library
  const renderLibrary = () => {
    const list = $('library');
    if (store.library.length === 0) {
      list.innerHTML = '<li class="empty">No books yet.</li>';
      return;
    }
    list.innerHTML = store.library
      .map(
        (b) => `<li>
          <div><strong>${esc(b.title)}</strong><small>${b.wordCount.toLocaleString()} words</small></div>
          <button data-read="${b.id}" class="primary">Read</button>
          <button data-del="${b.id}" class="ghost" aria-label="Delete ${esc(b.title)}">Delete</button>
        </li>`,
      )
      .join('');
  };

  $('library').addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const read = t.dataset.read;
    const del = t.dataset.del;
    if (read) await app.openBook(read);
    if (del && confirm('Delete this book from the library?')) {
      if (app.book?.id === del) await app.showLibrary();
      await store.removeBook(del);
      renderLibrary();
      if (app.mode === 'library') app.refresh();
    }
  });

  const addBook = async (title: string, text: string) => {
    const count = tokenize(text).words.length;
    if (count === 0) {
      msg('That file has no readable text.', true);
      return;
    }
    msg('Saving...');
    await store.addBook(title, text, count);
    renderLibrary();
    if (app.mode === 'library') app.refresh();
    msg(`Added "${title}" (${count.toLocaleString()} words).`);
  };

  $<HTMLInputElement>('file').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      msg(`Converting ${file.name}...`);
      const book = await importFile(file);
      await addBook(book.title, book.text);
    } catch (err) {
      msg(`Import failed: ${(err as Error).message}`, true);
    }
  });

  $('paste-add').addEventListener('click', async () => {
    const title = $<HTMLInputElement>('paste-title');
    const text = $<HTMLTextAreaElement>('paste-text');
    if (!text.value.trim()) return;
    await addBook(title.value.trim() || 'Pasted text', text.value);
    title.value = '';
    text.value = '';
  });

  // ---------------------------------------------------------------- reader controls
  $('toggle').addEventListener('click', () => app.toggle());
  $('prev').addEventListener('click', () => app.stepSentence(-1));
  $('next').addEventListener('click', () => app.stepSentence(1));
  $('slower').addEventListener('click', () => app.adjustWpm(-1));
  $('faster').addEventListener('click', () => app.adjustWpm(1));
  $('back').addEventListener('click', () => void app.showLibrary());
  $<HTMLInputElement>('seek').addEventListener('input', (e) => {
    app.seekTo(Number((e.target as HTMLInputElement).value));
  });

  const renderReader = () => {
    const reading = app.mode === 'reader' && app.session;
    $('reader-controls').hidden = !reading;
    if (!reading || !app.session) return;
    $('now').textContent = app.book?.title ?? '';
    $('toggle').textContent = app.playing ? 'Pause' : 'Play';
    $('wpm-label').textContent = `${store.settings.wpm} wpm`;
    const seek = $<HTMLInputElement>('seek');
    seek.max = String(app.session.length - 1);
    if (document.activeElement !== seek) seek.value = String(app.session.index);
  };

  // ---------------------------------------------------------------- settings
  const s = store.settings;
  type Binding = [id: string, out: string | null, get: () => number | string | boolean, set: (v: string, el: HTMLInputElement) => void, fmt?: (v: number) => string];
  const bindings: Binding[] = [
    ['s-wpm', 'o-wpm', () => s.wpm, (v) => (s.wpm = Number(v)), (v) => `${v} wpm`],
    ['s-long', 'o-long', () => s.pacing.longWordDelayMs, (v) => (s.pacing.longWordDelayMs = Number(v)), (v) => `${v} ms`],
    ['s-complex', 'o-complex', () => s.pacing.complexWordDelayMs, (v) => (s.pacing.complexWordDelayMs = Number(v)), (v) => `${v} ms`],
    ['s-punct', 'o-punct', () => s.pacing.punctuationDelayMs, (v) => (s.pacing.punctuationDelayMs = Number(v)), (v) => `${v} ms`],
    ['s-align', null, () => s.alignment, (v) => (s.alignment = v as 'orp' | 'center')],
    ['s-guides', null, () => s.showGuides, (_v, el) => (s.showGuides = el.checked)],
    ['s-bright', 'o-bright', () => s.wordBrightness, (v) => (s.wordBrightness = Number(v)), (v) => `${v} / 4`],
    ['s-scale', 'o-scale', () => s.fontScale, (v) => (s.fontScale = Number(v)), (v) => `${v}`],
  ];

  const renderSettings = () => {
    for (const [id, out, get, , fmt] of bindings) {
      const el = $<HTMLInputElement>(id);
      const value = get();
      if (el.type === 'checkbox') el.checked = Boolean(value);
      else if (document.activeElement !== el) el.value = String(value);
      if (out && fmt) $(out).textContent = fmt(Number(value));
    }
  };

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  for (const [id, , , set] of bindings) {
    const el = $<HTMLInputElement>(id);
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      set(el.value, el);
      renderSettings();
      app.refresh();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void store.saveSettings(), 400);
    });
  }

  app.onChange(() => {
    renderReader();
    renderSettings();
  });
  renderLibrary();
  renderSettings();
  renderReader();
  fitLens();
}
