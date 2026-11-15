/**
 * Share a single recipe as one or more QR codes – fully offline, no server.
 *
 * Pipeline:  Recipe → slim payload (only what a human wrote) → JSON → raw
 * DEFLATE → base64url text → split into frames small enough to stay a
 * comfortably scannable QR. Each frame is self-describing:
 *
 *     LR1.<id>.<seq>.<total>.<chunk>
 *
 * so the importer knows from the very first frame it sees how many frames to
 * expect and when it has them all – no "this is a multi-part code" switch to
 * flip. One frame (total = 1) and many frames use the exact same path.
 *
 * Derived data (Fineli matches, confidences, ids, timestamps, import report)
 * is never sent: the receiver re-parses the raw ingredient lines and re-matches
 * them against its own Fineli dataset on import.
 *
 * This module is pure (no DOM): it is unit-tested directly.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { z } from 'zod'
import type { Recipe } from '../domain/types'

export const SHARE_VERSION = 1
/** Magic prefix + format version. Bump the digit on a breaking format change. */
export const FRAME_MAGIC = 'LR1'
const FRAME_SEP = '.'
/** A payload up to this many base64url chars is sent as a single static QR. */
export const SINGLE_MAX_CHARS = 1000
/** base64url chars per frame once we go multi-frame (keeps each frame ≲ QR v21 at EC-M). */
export const CHUNK_CHARS = 720

const shareIngredientSchema = z.object({
  /** Original line exactly as written ("2 dl kermaa"). */
  r: z.string(),
  /** Optional group heading this line belongs under ("Kastike"). */
  g: z.string().optional(),
})

export const sharePayloadSchema = z.object({
  v: z.literal(SHARE_VERSION),
  t: z.string().min(1), // title
  d: z.string().optional(), // description
  s: z.number().positive().optional(), // servings
  st: z.string().optional(), // servingsText
  tp: z.number().optional(), // prepTimeMin
  tc: z.number().optional(), // cookTimeMin
  tt: z.number().optional(), // totalTimeMin
  xt: z.string().optional(), // timeText
  i: z.array(shareIngredientSchema), // ingredients
  n: z.array(z.string()), // instructions
  no: z.string().optional(), // user notes
  tg: z.array(z.string()).optional(), // tags
  c: z.string().optional(), // category
  cu: z.string().optional(), // cuisine
  sn: z.string().optional(), // source name
  su: z.string().optional(), // source url
  au: z.string().optional(), // author
  im: z.string().optional(), // image url
  at: z
    .object({
      l: z.string(), // license
      lu: z.string().optional(), // license url
      ot: z.string().optional(), // original text (historical recipes)
      oy: z.number().optional(), // original year
      oti: z.string().optional(), // original title
      ch: z.string().optional(), // changes made
    })
    .optional(),
})
export type SharePayload = z.infer<typeof sharePayloadSchema>

/**
 * A bundle carries several recipes in one transfer. It rides the exact same
 * frame transport as a single recipe – the importer never has to know in
 * advance whether a code holds one recipe or many.
 */
export const shareBundleSchema = z.object({
  v: z.literal(SHARE_VERSION),
  b: z.array(sharePayloadSchema).min(1), // the recipes in this bundle
})
export type ShareBundle = z.infer<typeof shareBundleSchema>

/** Drop keys whose value is undefined so they never reach the JSON. */
function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

const orUndef = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v)

export function recipeToSharePayload(recipe: Recipe): SharePayload {
  const at = recipe.attribution
  const tags = recipe.tags.filter((tag) => !tag.startsWith('tyyppi:'))
  return clean({
    v: SHARE_VERSION,
    t: recipe.title,
    d: orUndef(recipe.description),
    s: recipe.servings,
    st: orUndef(recipe.servingsText),
    tp: orUndef(recipe.prepTimeMin),
    tc: orUndef(recipe.cookTimeMin),
    tt: orUndef(recipe.totalTimeMin),
    xt: orUndef(recipe.timeText),
    i: recipe.ingredients.map((ing) => clean({ r: ing.raw, g: orUndef(ing.group) })),
    n: recipe.instructions,
    no: orUndef(recipe.notes),
    tg: tags.length ? tags : undefined,
    c: orUndef(recipe.category),
    cu: orUndef(recipe.cuisine),
    sn: orUndef(recipe.sourceName),
    su: orUndef(recipe.sourceUrl),
    au: orUndef(recipe.author),
    im: orUndef(recipe.imageUrl),
    at: at
      ? clean({
          l: at.license,
          lu: orUndef(at.licenseUrl),
          ot: orUndef(at.originalText),
          oy: orUndef(at.originalYear),
          oti: orUndef(at.originalTitle),
          ch: orUndef(at.changes),
        })
      : undefined,
  }) as SharePayload
}

// ---- base64url over bytes (works in browser and Node) ---------------------

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4))
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function sliceChunks(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/** Short, non-guessable id grouping the frames of one transfer (base36, 4 chars). */
function randomId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(4))
  let s = ''
  for (let i = 0; i < 4; i++) {
    const n = bytes ? bytes[i] : Math.floor(Math.random() * 256)
    s += alphabet[n % alphabet.length]
  }
  return s
}

export interface EncodedShare {
  id: string
  total: number
  /** Full frame strings, ready to render as QR codes (cycle through them for multi-frame). */
  frames: string[]
}

/** JSON → DEFLATE → base64url → self-describing frames. The heart of both paths. */
function encodeJson(obj: unknown): EncodedShare {
  const json = JSON.stringify(obj)
  const compressed = deflateSync(strToU8(json), { level: 9 })
  const text = bytesToBase64url(compressed)
  const parts = text.length <= SINGLE_MAX_CHARS ? [text] : sliceChunks(text, CHUNK_CHARS)
  const total = parts.length
  const id = randomId()
  const frames = parts.map((chunk, i) => [FRAME_MAGIC, id, i + 1, total, chunk].join(FRAME_SEP))
  return { id, total, frames }
}

export function encodePayload(payload: SharePayload): EncodedShare {
  return encodeJson(payload)
}

export function encodeRecipe(recipe: Recipe): EncodedShare {
  return encodeJson(recipeToSharePayload(recipe))
}

/**
 * Encode one *or many* recipes into a single transfer. One recipe is sent as a
 * plain payload (smallest code); several travel as a bundle. Either way the
 * result is the same stream of frames, so the importer handles both the same.
 */
export function encodeRecipes(recipes: Recipe[]): EncodedShare {
  const payloads = recipes.map(recipeToSharePayload)
  if (payloads.length === 1) return encodeJson(payloads[0])
  const bundle: ShareBundle = { v: SHARE_VERSION, b: payloads }
  return encodeJson(bundle)
}

// ---- decoding -------------------------------------------------------------

export type ShareErrorCode = 'incomplete' | 'corrupt' | 'invalid' | 'empty'

export class ShareDecodeError extends Error {
  code: ShareErrorCode
  constructor(code: ShareErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface ParsedFrame {
  id: string
  seq: number
  total: number
  chunk: string
}

/** Parse one scanned string. Returns null for anything that is not our frame. */
export function parseFrame(text: string): ParsedFrame | null {
  if (typeof text !== 'string' || !text.startsWith(FRAME_MAGIC + FRAME_SEP)) return null
  const parts = text.split(FRAME_SEP)
  if (parts.length < 5) return null
  const [, id, seqStr, totalStr] = parts
  const seq = Number(seqStr)
  const total = Number(totalStr)
  // base64url never contains '.', so the chunk is exactly the 5th field.
  const chunk = parts[4]
  if (!id || !Number.isInteger(seq) || !Number.isInteger(total)) return null
  if (seq < 1 || total < 1 || seq > total) return null
  if (!/^[A-Za-z0-9_-]+$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(chunk)) return null
  return { id, seq, total, chunk }
}

/**
 * Reassemble a complete set of frames (same id) into one or more validated
 * recipe payloads – a single recipe yields one, a bundle yields several.
 */
export function decodeFrames(frames: ParsedFrame[]): SharePayload[] {
  if (frames.length === 0) throw new ShareDecodeError('empty', 'Ei luettavia QR-kuvia.')
  const { id, total } = frames[0]
  const bySeq = new Map<number, string>()
  for (const f of frames) {
    if (f.id !== id || f.total !== total) continue
    bySeq.set(f.seq, f.chunk)
  }
  if (bySeq.size !== total) {
    throw new ShareDecodeError('incomplete', `Puuttuu ${total - bySeq.size} / ${total} kuvaa.`)
  }
  let text = ''
  for (let seq = 1; seq <= total; seq++) {
    const chunk = bySeq.get(seq)
    if (chunk === undefined) throw new ShareDecodeError('incomplete', `Kuva ${seq} / ${total} puuttuu.`)
    text += chunk
  }
  let json: string
  try {
    json = strFromU8(inflateSync(base64urlToBytes(text)))
  } catch {
    throw new ShareDecodeError('corrupt', 'QR-koodin tiedot ovat vioittuneet. Yritä skannata uudelleen.')
  }
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    throw new ShareDecodeError('corrupt', 'QR-koodin tiedot ovat vioittuneet. Yritä skannata uudelleen.')
  }
  // A bundle (many recipes) and a single recipe are unambiguous: a bundle has
  // the required `b` array and no title; a single recipe has the required title.
  const bundle = shareBundleSchema.safeParse(obj)
  if (bundle.success) return bundle.data.b
  const single = sharePayloadSchema.safeParse(obj)
  if (single.success) return [single.data]
  throw new ShareDecodeError('invalid', 'QR-koodi ei sisältänyt kelvollista reseptiä (väärä tai liian uusi muoto).')
}

export type CollectorResult =
  | { status: 'ignored' }
  | { status: 'progress'; have: number; total: number }
  | { status: 'complete'; payloads: SharePayload[] }
  | { status: 'error'; code: ShareErrorCode; message: string }

/**
 * Stateful collector for the live scanner: feed it every decoded QR string.
 * It groups frames by transfer id, restarts automatically if a different
 * transfer appears, and returns `complete` only once every frame is in.
 */
export function createFrameCollector() {
  let activeId: string | null = null
  let total = 0
  const chunks = new Map<number, string>()

  function reset() {
    activeId = null
    total = 0
    chunks.clear()
  }

  function add(text: string): CollectorResult {
    const frame = parseFrame(text)
    if (!frame) return { status: 'ignored' }
    // A frame from a different transfer (or a changed total) starts over.
    if (frame.id !== activeId || frame.total !== total) {
      activeId = frame.id
      total = frame.total
      chunks.clear()
    }
    chunks.set(frame.seq, frame.chunk)
    if (chunks.size < total) return { status: 'progress', have: chunks.size, total }
    const collected: ParsedFrame[] = [...chunks.entries()].map(([seq, chunk]) => ({ id: activeId!, seq, total, chunk }))
    try {
      const payloads = decodeFrames(collected)
      reset()
      return { status: 'complete', payloads }
    } catch (e) {
      const err = e as ShareDecodeError
      reset()
      return { status: 'error', code: err.code ?? 'corrupt', message: err.message }
    }
  }

  return {
    add,
    reset,
    get have() {
      return chunks.size
    },
    get total() {
      return total
    },
  }
}
