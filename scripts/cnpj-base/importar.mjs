#!/usr/bin/env node
// ============================================================
// Carrega a base de CNPJ do Extrator de leads a partir dos arquivos
// públicos da Receita Federal (docs/extrator-leads.md).
//
//   CNPJ_BASE_URL=https://xxxx.supabase.co \
//   CNPJ_BASE_KEY=<chave de serviço desse projeto> \
//   node scripts/cnpj-base/importar.mjs [--mes 2026-11] [--uf GO,TO] [--pasta ./.cnpj-cache]
//
//   --mes     o mês da Receita a carregar (padrão: o mais recente)
//   --uf      só estes estados (padrão: o Brasil inteiro)
//   --pasta   onde guardar os arquivos baixados (cerca de 8 GB)
//   --baixar  só baixa, sem carregar
//
// O que faz, na ordem:
//   1. lista e baixa os arquivos do mês (continua de onde parou);
//   2. lê o Simples e separa quem é MEI;
//   3. carrega os estabelecimentos ATIVOS;
//   4. carrega as empresas desses estabelecimentos e os responsáveis;
//   5. carrega atividades (CNAE) e municípios;
//   6. apaga da base o que não veio neste mês (empresas que fecharam).
//
// Pode ser interrompido e rodado de novo: cada linha é gravada por
// cima da anterior, e nada é apagado antes do passo 6.
//
// Precisa do Node 20+ e do comando `unzip` (já vem no macOS e no Linux).
// ============================================================

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  NumberSet,
  cnae,
  empresa,
  estabelecimento,
  meiBasico,
  municipio,
  packBasico,
  parseLine,
  responsavel,
} from './layout.mjs'

const SHARE = 'gn672Ad4CF8N6TK'
const WEBDAV = 'https://arquivos.receitafederal.gov.br/public.php/webdav/Dados/Cadastros/CNPJ'
const AUTH = 'Basic ' + Buffer.from(`${SHARE}:`).toString('base64')

const BATCH = 2000
const PARALLEL = 4

function args() {
  const out = { mes: null, ufs: null, pasta: '.cnpj-cache', baixar: false }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--mes') out.mes = argv[++i]
    else if (a === '--uf') {
      out.ufs = new Set(
        String(argv[++i] ?? '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      )
    } else if (a === '--pasta') out.pasta = argv[++i]
    else if (a === '--baixar') out.baixar = true
    else {
      console.error(`Opção desconhecida: ${a}`)
      process.exit(1)
    }
  }
  return out
}

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m)

async function propfind(path) {
  const res = await fetch(`${WEBDAV}/${path}`, {
    method: 'PROPFIND',
    headers: { Authorization: AUTH, Depth: '1' },
  })
  if (!res.ok) throw new Error(`A Receita respondeu ${res.status} ao listar ${path || 'a pasta'}`)
  const xml = await res.text()
  const entries = []
  for (const block of xml.split(/<d:response>/).slice(1)) {
    const href = /<d:href>([^<]+)<\/d:href>/.exec(block)?.[1] ?? ''
    const size = Number(/<d:getcontentlength>(\d+)<\/d:getcontentlength>/.exec(block)?.[1] ?? 0)
    const name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop() ?? '')
    entries.push({ name, size, folder: href.endsWith('/') })
  }
  return entries
}

async function latestMonth() {
  const months = (await propfind(''))
    .filter((e) => e.folder && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
  if (months.length === 0) throw new Error('Não achei as pastas dos meses na Receita.')
  return months[months.length - 1]
}

/** Baixa um arquivo, continuando de onde parou. O servidor é lento. */
async function download(mes, file, pasta) {
  const target = join(pasta, `${mes}-${file.name}`)
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const have = existsSync(target) ? statSync(target).size : 0
    if (have === file.size) return target
    if (have > file.size) throw new Error(`${target} está maior que o original; apague e rode de novo.`)
    try {
      const res = await fetch(`${WEBDAV}/${mes}/${encodeURIComponent(file.name)}`, {
        headers: { Authorization: AUTH, ...(have ? { Range: `bytes=${have}-` } : {}) },
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const resumed = res.status === 206
      await pipeline(Readable.fromWeb(res.body), createWriteStream(target, { flags: resumed ? 'a' : 'w' }))
    } catch (err) {
      log(`  ${file.name}: ${err.message}; tentando de novo (${attempt})`)
      await new Promise((r) => setTimeout(r, Math.min(60_000, attempt * 5000)))
    }
  }
  throw new Error(`Não consegui baixar ${file.name}.`)
}

/** As linhas de um .zip da Receita, já em texto. */
async function* lines(zipPath) {
  const child = spawn('unzip', ['-p', zipPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  const decoder = new TextDecoder('latin1')
  let rest = ''
  for await (const chunk of child.stdout) {
    const text = rest + decoder.decode(chunk, { stream: true })
    const parts = text.split('\n')
    rest = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.endsWith('\r') ? part.slice(0, -1) : part
      if (line) yield line
    }
  }
  if (rest.trim()) yield rest.trim()
}

/** Grava em lotes, alguns ao mesmo tempo, com novas tentativas. */
class Uploader {
  constructor(baseUrl, key, table, conflict, { ignoreDuplicates = false } = {}) {
    this.url = `${baseUrl.replace(/\/+$/, '')}/rest/v1/${table}?on_conflict=${conflict}`
    this.headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: `resolution=${ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates'},return=minimal`,
    }
    this.conflict = conflict
    this.buffer = new Map()
    this.running = new Set()
    this.sent = 0
  }

  async add(row) {
    // A mesma chave duas vezes num lote faz o banco recusar o lote.
    this.buffer.set(row[this.conflict], row)
    if (this.buffer.size >= BATCH) await this.flush()
  }

  async flush() {
    if (this.buffer.size === 0) return
    const rows = [...this.buffer.values()]
    this.buffer = new Map()
    while (this.running.size >= PARALLEL) await Promise.race(this.running)
    const job = this.post(rows).finally(() => this.running.delete(job))
    this.running.add(job)
  }

  async post(rows) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const res = await fetch(this.url, { method: 'POST', headers: this.headers, body: JSON.stringify(rows) })
        if (res.ok) {
          this.sent += rows.length
          return
        }
        const detail = (await res.text()).slice(0, 300)
        if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) {
          throw Object.assign(new Error(`A base recusou o lote (${res.status}): ${detail}`), { fatal: true })
        }
        throw new Error(`HTTP ${res.status}: ${detail}`)
      } catch (err) {
        if (err.fatal || attempt >= 8) throw err
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2 ** attempt * 500)))
      }
    }
  }

  async done() {
    await this.flush()
    await Promise.all(this.running)
    return this.sent
  }
}

async function rpc(baseUrl, key, fn, body) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function main() {
  const opt = args()
  const baseUrl = process.env.CNPJ_BASE_URL
  const key = process.env.CNPJ_BASE_KEY
  if (!opt.baixar && (!baseUrl || !key)) {
    console.error('Defina CNPJ_BASE_URL e CNPJ_BASE_KEY (a chave de serviço do projeto da base).')
    process.exit(1)
  }
  mkdirSync(opt.pasta, { recursive: true })

  const mes = opt.mes ?? (await latestMonth())
  const files = (await propfind(`${mes}/`)).filter((e) => !e.folder && e.name.endsWith('.zip'))
  const pick = (prefix) => files.filter((f) => f.name.startsWith(prefix)).sort((a, b) => a.name.localeCompare(b.name))
  const total = files.reduce((sum, f) => sum + f.size, 0)
  log(`Mês ${mes}: ${files.length} arquivos, ${(total / 1e9).toFixed(1)} GB${opt.ufs ? `, só ${[...opt.ufs].join(', ')}` : ''}`)

  const wanted = [
    ...pick('Simples'),
    ...pick('Estabelecimentos'),
    ...pick('Empresas'),
    ...pick('Socios'),
    ...pick('Cnaes'),
    ...pick('Municipios'),
  ]
  const local = new Map()
  for (const file of wanted) {
    log(`Baixando ${file.name} (${(file.size / 1e6).toFixed(0)} MB)`)
    local.set(file.name, await download(mes, file, opt.pasta))
  }
  if (opt.baixar) {
    log('Arquivos baixados.')
    return
  }
  const pathsOf = (prefix) => pick(prefix).map((f) => local.get(f.name))

  // 2. Quem é MEI.
  const meis = new NumberSet()
  for (const path of pathsOf('Simples')) {
    for await (const line of lines(path)) {
      const basico = meiBasico(parseLine(line))
      if (basico) meis.add(packBasico(basico))
    }
  }
  meis.seal()
  log(`MEIs: ${meis.size.toLocaleString('pt-BR')}`)

  // 3. Estabelecimentos ativos.
  const basicos = new NumberSet()
  const ufOf = new Map()
  const estUp = new Uploader(baseUrl, key, 'cnpj_estabelecimentos', 'cnpj')
  for (const path of pathsOf('Estabelecimentos')) {
    let read = 0
    for await (const line of lines(path)) {
      read += 1
      const row = estabelecimento(parseLine(line), mes, opt.ufs)
      if (!row) continue
      basicos.add(packBasico(row.basico))
      if (row.municipio && row.uf) ufOf.set(row.municipio, row.uf)
      await estUp.add(row)
    }
    log(`  ${path.split('/').pop()}: ${read.toLocaleString('pt-BR')} linhas lidas, ${estUp.sent.toLocaleString('pt-BR')} ativas gravadas`)
  }
  log(`Estabelecimentos ativos: ${(await estUp.done()).toLocaleString('pt-BR')}`)
  basicos.seal()

  // 4. As empresas deles, e quem responde por elas.
  const empUp = new Uploader(baseUrl, key, 'cnpj_empresas', 'basico')
  for (const path of pathsOf('Empresas')) {
    for await (const line of lines(path)) {
      const f = parseLine(line)
      const packed = packBasico((f[0] ?? '').trim().toUpperCase())
      if (!basicos.has(packed)) continue
      const row = empresa(f, mes, meis.has(packed))
      if (row) await empUp.add(row)
    }
    log(`  ${path.split('/').pop()}: ${empUp.sent.toLocaleString('pt-BR')} empresas gravadas`)
  }
  log(`Empresas: ${(await empUp.done()).toLocaleString('pt-BR')}`)

  const respUp = new Uploader(baseUrl, key, 'cnpj_responsaveis', 'basico')
  for (const path of pathsOf('Socios')) {
    for await (const line of lines(path)) {
      const row = responsavel(parseLine(line), mes)
      if (!row) continue
      if (!basicos.has(packBasico(row.basico))) continue
      await respUp.add(row)
    }
  }
  log(`Responsáveis: ${(await respUp.done()).toLocaleString('pt-BR')}`)

  // 5. Atividades e municípios.
  const cnaeUp = new Uploader(baseUrl, key, 'cnpj_cnaes', 'codigo')
  for (const path of pathsOf('Cnaes')) {
    for await (const line of lines(path)) {
      const row = cnae(parseLine(line))
      if (row) await cnaeUp.add(row)
    }
  }
  log(`Atividades: ${await cnaeUp.done()}`)

  const munUp = new Uploader(baseUrl, key, 'cnpj_municipios', 'codigo')
  for (const path of pathsOf('Municipios')) {
    for await (const line of lines(path)) {
      const row = municipio(parseLine(line))
      // Sem estabelecimento ativo carregado, o município fica de fora.
      if (row && ufOf.has(row.codigo)) await munUp.add({ ...row, uf: ufOf.get(row.codigo) })
    }
  }
  log(`Municípios: ${await munUp.done()}`)

  // 6. O que não veio neste mês sai. Numa carga parcial (--uf), os
  //    outros estados também saem: a base passa a ter só o que foi pedido.
  let removed = 0
  for (;;) {
    const n = Number(await rpc(baseUrl, key, 'cnpj_finalizar_lote', { p_lote: mes }))
    if (!n) break
    removed += n
  }
  log(`Fora da base (não vieram em ${mes}): ${removed.toLocaleString('pt-BR')}`)
  log('Pronto.')
}

main().catch((err) => {
  console.error('\nFalhou:', err.message)
  process.exit(1)
})
