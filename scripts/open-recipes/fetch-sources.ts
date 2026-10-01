/**
 * Downloads the open recipe sources into data/open-recipes/raw/ (not committed – rerun to refresh).
 *
 *   node scripts/open-recipes/fetch-sources.ts [--kitchengadget <path to KG8K recipes dir>]
 *
 * MyPlate is fetched page by page with its own script (fetch-myplate.ts).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const RAW = resolve(import.meta.dirname, '../../data/open-recipes/raw')

async function download(url: string, file: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  console.log(`✓ ${file.replace(RAW + '/', '')}`)
}

// Wikibooks Cookbook, parsed dump 2024-07-31 (CC BY-SA 4.0)
await download('https://huggingface.co/datasets/gossminn/wikibooks-cookbook/resolve/main/recipes_parsed.json', join(RAW, 'wikibooks', 'recipes_parsed.json'))
await download('https://huggingface.co/datasets/gossminn/wikibooks-cookbook/resolve/main/README.md', join(RAW, 'wikibooks', 'README.md'))

// UniTools world recipes v1 (CC BY-SA 4.0)
await download('https://theunitools.com/data/unitools-recipes-v1.json', join(RAW, 'unitools', 'unitools-recipes-v1.json'))

// ForkRecipe (CC BY-SA 4.0)
const fork = join(RAW, 'forkrecipe', 'repo')
rmSync(fork, { recursive: true, force: true })
execFileSync('git', ['clone', '--quiet', '--depth', '1', 'https://github.com/futurechef/forkrecipe-recipes', fork], { stdio: 'inherit' })
rmSync(join(fork, '.git'), { recursive: true, force: true })
console.log('✓ forkrecipe/repo')

// KitchenGadget8000 recipe set: copied from a local checkout
const kgArg = process.argv.indexOf('--kitchengadget')
const kgDir = kgArg > 0 ? resolve(process.argv[kgArg + 1]) : null
if (kgDir && existsSync(kgDir)) {
  const target = join(RAW, 'kitchengadget')
  mkdirSync(target, { recursive: true })
  for (const f of readdirSync(kgDir).filter((f) => f.endsWith('.md'))) cpSync(join(kgDir, f), join(target, f))
  console.log('✓ kitchengadget')
} else {
  console.log('– kitchengadget skipped (pass --kitchengadget <KG8K_v2/spiffs_data/recipes>)')
}
