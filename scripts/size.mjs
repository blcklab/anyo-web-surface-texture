import { gzipSync } from 'node:zlib'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
const dist = new URL('../dist/', import.meta.url).pathname
async function walk(path) {
  const out = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full)); else out.push(full)
  }
  return out
}
let raw = 0, gzip = 0
for (const file of await walk(dist)) {
  if (!file.endsWith('.js')) continue
  const data = await readFile(file)
  raw += (await stat(file)).size
  gzip += gzipSync(data).length
}
console.log(JSON.stringify({ javascriptBytes: raw, javascriptGzipBytes: gzip }, null, 2))
if (gzip > 28000) throw new Error(`Published JavaScript exceeds 28 kB gzip budget: ${gzip}`)
