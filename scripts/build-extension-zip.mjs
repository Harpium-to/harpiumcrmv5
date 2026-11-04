// ============================================================
// Packs extension/ into public/downloads/crm-connector.zip, so the
// CRM can offer it for download (Settings › Extensão do Chrome).
//
// Runs before `next build` and `next dev` (npm pre-scripts). Plain
// Node, no dependencies: the project has no zip library and the build
// image may not have the `zip` command. The output is reproducible —
// fixed timestamps, sorted entries — so an unchanged extension gives a
// byte-identical file.
//
// Everything sits under a top folder, crm-connector/, which is what
// the person selects in chrome://extensions › "Carregar sem compactação".
// Tests (*.test.js) and OS junk are left out.
// ============================================================

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const SKIP = (name) =>
  name.endsWith('.test.js') || name === '.DS_Store' || name.startsWith('.')

/** Relative paths of every file to pack, sorted, with "/" separators. */
export function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(root, full).split(sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

/**
 * A ZIP archive (deflate) of `files` read from `root`, each stored as
 * `${prefix}/${path}`. DOS date fixed at 1980-01-01 for reproducibility.
 */
export function zipFiles(root, files, prefix) {
  const DOS_TIME = 0
  const DOS_DATE = (0 << 9) | (1 << 5) | 1
  const UTF8 = 0x0800
  const locals = []
  const centrals = []
  let offset = 0

  for (const path of files) {
    const data = readFileSync(join(root, path))
    const compressed = deflateRawSync(data, { level: 9 })
    const name = Buffer.from(`${prefix}/${path}`, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(UTF8, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + compressed.length
  }

  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, cd, end])
}

// CLI — only when run directly, not when imported by the tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
  const root = join(repo, 'extension')
  const outFile = join(repo, 'public', 'downloads', 'crm-connector.zip')
  const files = listFiles(root)
  const zip = zipFiles(root, files, 'crm-connector')
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, zip)
  console.log(
    `[extension] ${files.length} arquivos → public/downloads/crm-connector.zip (${(zip.length / 1024).toFixed(1)} KB)`,
  )
}
