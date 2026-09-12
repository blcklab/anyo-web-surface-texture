import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const root = new URL('../src/', import.meta.url)
async function walk(path) {
  const out = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}
const files = await walk(root.pathname)
for (const file of files) {
  const source = await readFile(file, 'utf8')
  if (/eval\s*\(|new\s+Function\s*\(/.test(source)) throw new Error(`Dynamic code execution found in ${file}`)
  if (/requestAnimationFrame\s*\(/.test(source)) throw new Error(`Permanent RAF ownership found in ${file}`)
  if (/from ['"](?:react|vue|three)['"]/.test(source)) throw new Error(`Forbidden framework/runtime dependency found in ${file}`)
}
console.log(`Verified ${files.length} source files: no dynamic code, private RAF, UI framework, or Three.js dependency.`)
