// Lightweight file conversion for the phone companion.
// Mirrors the formats RSVP Nano accepts: EPUB, plain text, Markdown, HTML and XHTML.
import { strFromU8, unzipSync } from 'fflate';

export interface ImportedBook {
  title: string;
  text: string;
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'BR', 'HR',
]);

/** Convert an HTML/XHTML string into paragraphs separated by blank lines. */
export function htmlToText(html: string, mime: DOMParserSupportedType = 'text/html'): string {
  let doc = new DOMParser().parseFromString(html, mime);
  if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, nav[epub\\:type="toc"], head').forEach((n) => n.remove());
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName.toUpperCase();
    const block = BLOCK_TAGS.has(tag);
    if (block) out.push('\n\n');
    node.childNodes.forEach(walk);
    if (block) out.push('\n\n');
  };
  walk(doc.body ?? doc.documentElement);
  return out
    .join('')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function markdownToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1');
}

function resolvePath(base: string, href: string): string {
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '').concat(href).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return decodeURIComponent(out.join('/'));
}

export function epubToBook(data: Uint8Array, fallbackTitle: string): ImportedBook {
  const files = unzipSync(data);
  const read = (path: string) => {
    const f = files[path];
    if (!f) throw new Error(`EPUB is missing ${path}`);
    return strFromU8(f);
  };
  const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

  const container = xml(read('META-INF/container.xml'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB has no package document');
  const opf = xml(read(opfPath));

  const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || fallbackTitle;
  const manifest = new Map<string, string>();
  opf.querySelectorAll('manifest > item').forEach((item) => {
    manifest.set(item.getAttribute('id') ?? '', item.getAttribute('href') ?? '');
  });

  const chapters: string[] = [];
  opf.querySelectorAll('spine > itemref').forEach((ref) => {
    const href = manifest.get(ref.getAttribute('idref') ?? '');
    if (!href) return;
    const path = resolvePath(opfPath, href);
    if (!files[path]) return;
    const text = htmlToText(strFromU8(files[path]), 'application/xhtml+xml');
    if (text) chapters.push(text);
  });
  if (chapters.length === 0) throw new Error('No readable chapters found in this EPUB');
  return { title, text: chapters.join('\n\n') };
}

export async function importFile(file: File): Promise<ImportedBook> {
  const name = file.name;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const baseTitle = name.replace(/\.[^.]+$/, '');
  if (ext === 'epub') return epubToBook(new Uint8Array(await file.arrayBuffer()), baseTitle);
  const raw = await file.text();
  if (ext === 'html' || ext === 'htm') return { title: baseTitle, text: htmlToText(raw) };
  if (ext === 'xhtml') return { title: baseTitle, text: htmlToText(raw, 'application/xhtml+xml') };
  if (ext === 'md' || ext === 'markdown') return { title: baseTitle, text: markdownToText(raw) };
  return { title: baseTitle, text: raw };
}
