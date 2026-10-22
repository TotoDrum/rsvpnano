// Thin layer over the Even Hub page APIs.
//
// textContainerUpgrade costs roughly 80 ms per call over BLE, so calls are
// serialized: only one is in flight, and while it runs newer content for the
// same container replaces older pending content. At high WPM this drops stale
// words instead of building an ever-growing backlog.
import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';

export const SCREEN_W = 576;
export const SCREEN_H = 288;

export interface TextBox {
  kind: 'text';
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  content: string;
  brightness?: number;
  capture?: boolean;
}

export interface ListBox {
  kind: 'list';
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  items: string[];
  selected: number;
  capture?: boolean;
}

export type Box = TextBox | ListBox;
export type Page = Box[];

type Listener = (page: Page) => void;

export class GlassesDisplay {
  private page: Page = [];
  private started = false;
  private pendingPage: Page | null = null;
  private pendingText = new Map<string, { content: string; brightness?: number }>();
  private busy = false;
  private listeners = new Set<Listener>();

  constructor(private readonly bridge: EvenAppBridge | null) {}

  /** Subscribe to the current page model, for the phone-side preview. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.page);
    return () => this.listeners.delete(listener);
  }

  current(): Page {
    return this.page;
  }

  /** Replace the whole page (layout change). */
  show(page: Page): void {
    this.page = page.map((b) => ({ ...b }));
    this.pendingPage = this.page;
    this.pendingText.clear();
    this.emit();
    void this.pump();
  }

  /** Re-send the current page, e.g. after the host cleared it for the exit dialog. */
  redraw(): void {
    this.show(this.page);
  }

  /** Clear context and status overlays by rebuilding the page. */
  clearOverlays(): void {
    for (const box of this.page) {
      if (box.kind === 'text' && (box.name === 'context' || box.name === 'status')) {
        box.content = '';
      }
    }
    const page = this.page.map((b) => ({ ...b }));
    this.pendingPage = page;
    this.pendingText.clear();
    this.emit();
    void this.pump();
  }

  /** Update one text container in place (flicker-free). */
  setText(name: string, content: string, brightness?: number): void {
    const box = this.page.find((b): b is TextBox => b.kind === 'text' && b.name === name);
    if (!box) return;
    if (box.content === content && (brightness === undefined || brightness === box.brightness)) return;
    box.content = content;
    if (brightness !== undefined) box.brightness = brightness;
    this.pendingText.set(name, { content, brightness });
    this.emit();
    void this.pump();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.page);
  }

  private async pump(): Promise<void> {
    if (this.busy || !this.bridge) return;
    this.busy = true;
    try {
      for (;;) {
        if (this.pendingPage) {
          const page = this.pendingPage;
          this.pendingPage = null;
          await this.sendPage(page);
          continue;
        }
        // Word container first so playback stays responsive.
        const name = this.pendingText.has('word') ? 'word' : this.pendingText.keys().next().value;
        if (name === undefined) break;
        const update = this.pendingText.get(name)!;
        this.pendingText.delete(name);
        const box = this.page.find((b) => b.name === name);
        if (!box) continue;
        await this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: box.id,
            containerName: box.name,
            content: update.content,
            contentLength: update.content.length,
            ...(update.brightness !== undefined ? { textColor: update.brightness } : {}),
          }),
        );
      }
    } catch (err) {
      console.error('Glasses update failed', err);
    } finally {
      this.busy = false;
    }
  }

  private async sendPage(page: Page): Promise<void> {
    if (!this.bridge) return;
    const textObject = page
      .filter((b): b is TextBox => b.kind === 'text')
      .map(
        (b, i) =>
          new TextContainerProperty({
            xPosition: b.x,
            yPosition: b.y,
            width: b.w,
            height: b.h,
            containerID: b.id,
            containerName: b.name,
            content: b.content.slice(0, 1000),
            isEventCapture: b.capture ? 1 : 0,
            borderWidth: 0,
            paddingLength: 0,
            zOrderIndex: i + 1,
            ...(b.brightness !== undefined ? { textColor: b.brightness } : {}),
          }),
      );
    const listObject = page
      .filter((b): b is ListBox => b.kind === 'list')
      .map(
        (b, i) =>
          new ListContainerProperty({
            xPosition: b.x,
            yPosition: b.y,
            width: b.w,
            height: b.h,
            containerID: b.id,
            containerName: b.name,
            isEventCapture: b.capture ? 1 : 0,
            borderWidth: 0,
            paddingLength: 4,
            zOrderIndex: textObject.length + i + 1,
            itemContainer: new ListItemContainerProperty({
              itemCount: b.items.length,
              itemWidth: 0,
              isItemSelectBorderEn: 1,
              itemName: b.items.map((s) => s.slice(0, 60)),
            }),
          }),
      );
    const payload = {
      containerTotalNum: textObject.length + listObject.length,
      ...(textObject.length ? { textObject } : {}),
      ...(listObject.length ? { listObject } : {}),
    };
    if (!this.started) {
      this.started = true;
      const result = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(payload));
      if (result !== 0) console.error('createStartUpPageContainer failed with code', result);
    } else {
      const ok = await this.bridge.rebuildPageContainer(new RebuildPageContainer(payload));
      if (!ok) console.error('rebuildPageContainer failed');
    }
  }
}
