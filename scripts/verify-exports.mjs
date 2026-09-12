import { access, readFile } from 'node:fs/promises'
const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
for (const [name, value] of Object.entries(pkg.exports)) {
  if (name === './package.json') continue
  const entry = typeof value === 'string' ? value : value.import
  const types = typeof value === 'string' ? null : value.types
  await access(new URL(entry, root))
  if (types) await access(new URL(types, root))
}
console.log(`Verified ${Object.keys(pkg.exports).length} package exports.`)
