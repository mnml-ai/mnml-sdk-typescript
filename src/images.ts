import type { ImageInput } from './types.js';

/**
 * A create call's images, made sendable as JSON: bytes become a base64 data
 * URI, and a string (a link, a data URI or base64) is sent as it is. The API
 * reads the bytes itself, so the type here is only a label.
 */

type Bytes = Uint8Array | ArrayBuffer | Blob;

const isBytes = (v: unknown): v is Bytes =>
  v instanceof Uint8Array ||
  v instanceof ArrayBuffer ||
  (typeof Blob !== 'undefined' && v instanceof Blob);

async function toUint8(v: Bytes): Promise<Uint8Array> {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return new Uint8Array(await v.arrayBuffer());
}

/** The image type the bytes declare by their first bytes; the API checks them again. */
function sniff(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

function base64(b: Uint8Array): string {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } })
    .Buffer;
  if (B) return B.from(b).toString('base64');
  // A browser: btoa takes a binary string, built in chunks so a large image fits the call stack.
  let binary = '';
  for (let i = 0; i < b.length; i += 0x8000) {
    binary += String.fromCharCode(...b.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function image(v: ImageInput): Promise<string> {
  if (typeof v === 'string') return v;
  const bytes = await toUint8(v);
  return `data:${sniff(bytes)};base64,${base64(bytes)}`;
}

/** An image field that is the image, or an object with one in `image`. */
async function imageOrSource(v: unknown): Promise<unknown> {
  if (typeof v === 'string' || isBytes(v)) return image(v);
  if (v && typeof v === 'object' && 'image' in v) {
    const src = v as { image: ImageInput };
    return { ...src, image: await image(src.image) };
  }
  return v;
}

/** The body with every image field encoded: `image`, `mask`, each reference, `end_frame`. */
export async function encodeImages<T extends object>(body: T): Promise<T> {
  const out = { ...body } as Record<string, unknown>;
  for (const field of ['image', 'mask', 'end_frame']) {
    if (out[field] !== undefined) out[field] = await imageOrSource(out[field]);
  }
  if (Array.isArray(out['references'])) {
    out['references'] = await Promise.all(out['references'].map(imageOrSource));
  }
  return out as T;
}
