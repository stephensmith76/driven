// Pictures for heroes and enemies. Files live in the public `portraits` bucket as
// <campaign id>/hero-<character id>.jpg and <campaign id>/enemy-<name>.jpg.
// The row's `portrait` column holds "<path>?v=<time>", so a new upload shows at once.
import { supabase } from './supabase'

const BUCKET = 'portraits'
const MAX_SIDE = 512

export const heroKey = (characterId: string) => `hero-${characterId}`

/** One picture per enemy name in a campaign, so the Butcher keeps his face from fight to fight. */
export const enemyKey = (name: string) =>
  `enemy-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unnamed'}`

/** Shrink a picked image to at most 512 px on its long side, as a JPEG. */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file.')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('That image could not be read.') })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot resize images.')
  ctx.fillStyle = '#fff'   // a transparent PNG gets a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85))
  if (!blob) throw new Error('That image could not be saved.')
  return blob
}

/** Upload (or replace) a picture. Returns the value to store in the row's `portrait` column. */
export async function uploadPortrait(campaignId: string, key: string, file: File): Promise<string> {
  return putPortrait(campaignId, key, await shrinkImage(file))
}

/** Store an already-shrunk picture at <folder>/<key>.jpg. The folder is a campaign id or a bank id. */
export async function putPortrait(folder: string, key: string, blob: Blob): Promise<string> {
  const path = `${folder}/${key}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true, contentType: 'image/jpeg', cacheControl: '3600',
  })
  if (error) throw new Error(`The picture could not be uploaded: ${error.message}`)
  return `${path}?v=${Date.now()}`
}

/** Delete the file behind a stored value. Failing to delete is not worth stopping for. */
export async function deletePortrait(value: string | null | undefined) {
  if (!value) return
  await supabase.storage.from(BUCKET).remove([value.split('?')[0]]).catch(() => undefined)
}

/** The public link for a stored value, or null. */
export function portraitUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const [path, query] = value.split('?')
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  return query ? `${url}?${query}` : url
}

/** A picture already uploaded for an enemy of this name, if there is one. Never throws. */
export async function findEnemyPortrait(campaignId: string, name: string): Promise<string | null> {
  try {
    const file = `${enemyKey(name)}.jpg`
    const { data, error } = await supabase.storage.from(BUCKET).list(campaignId, { search: file, limit: 20 })
    if (error || !data) return null
    const hit = data.find((f) => f.name === file)
    if (!hit) return null
    const stamp = Date.parse(hit.updated_at ?? hit.created_at ?? '') || 0
    return `${campaignId}/${file}?v=${stamp}`
  } catch {
    return null
  }
}

/** Turn an upload step into what PortraitPicker wants, with errors going to the screen's toast. */
export const viaRun = <A extends unknown[]>(run: (fn: () => Promise<unknown>) => void, fn: (...a: A) => Promise<unknown>) =>
  (...a: A) => new Promise<void>((done) => run(() => fn(...a).finally(done)))
