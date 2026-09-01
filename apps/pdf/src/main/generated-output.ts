import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'

/** Pick a safe, unused PDF path inside the configured DeepOffice save directory. */
export function uniqueGeneratedPdfPath(
  dir: string,
  suggestedName: string,
  pathExists: (path: string) => boolean = existsSync,
): string {
  // Control characters are intentionally rejected from generated file names.
  // eslint-disable-next-line no-control-regex
  const invalidFileNameCharacters = /[/\\:*?"<>|\u0000-\u001f]/g
  // basename only when the suggestion actually looks like a path (a pasted
  // path): on Windows it would otherwise read a lone-letter prefix before a
  // colon as a drive ('a:b.pdf' → 'b.pdf') and silently drop the name's start
  const raw = String(suggestedName || 'merged.pdf')
  const name = /[\\/]/.test(raw) ? basename(raw) : raw
  let fileName = name.replace(invalidFileNameCharacters, '_').trim()
  if (!fileName || fileName === '.' || fileName === '..') fileName = 'merged.pdf'
  if (!/\.pdf$/i.test(fileName)) fileName += '.pdf'

  const stem = fileName.slice(0, -4)
  let candidate = join(dir, fileName)
  for (let i = 2; pathExists(candidate); i++) candidate = join(dir, `${stem}-${i}.pdf`)
  return candidate
}
