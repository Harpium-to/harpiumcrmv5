// The packaging script lives in scripts/ but packs this folder, so its
// test sits here, next to what it ships (and inside vitest's include).

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { crc32, listFiles, zipFiles } from '../scripts/build-extension-zip.mjs'

const EXT = fileURLToPath(new URL('.', import.meta.url))

const hasUnzip = (() => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('extension zip', () => {
  it('packs what Chrome needs and leaves the tests out', () => {
    const files = listFiles(EXT)
    expect(files).toContain('manifest.json')
    expect(files).toContain('background.js')
    expect(files).toContain('content.js')
    expect(files).toContain('icons/icon-128.png')
    expect(files.some((f) => f.endsWith('.test.js'))).toBe(false)
  })

  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('is reproducible', () => {
    const files = listFiles(EXT)
    expect(zipFiles(EXT, files, 'crm-connector').equals(zipFiles(EXT, files, 'crm-connector'))).toBe(true)
  })

  it.skipIf(!hasUnzip)('is a valid archive that unzips to a crm-connector/ folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ext-zip-'))
    const zipPath = join(dir, 'crm-connector.zip')
    writeFileSync(zipPath, zipFiles(EXT, listFiles(EXT), 'crm-connector'))
    // -t checks every entry's CRC.
    expect(execFileSync('unzip', ['-t', zipPath]).toString()).toContain('No errors detected')
    execFileSync('unzip', ['-q', zipPath, '-d', dir])
    const manifest = JSON.parse(readFileSync(join(dir, 'crm-connector', 'manifest.json'), 'utf8'))
    expect(manifest.manifest_version).toBe(3)
  })
})
