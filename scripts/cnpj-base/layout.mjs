// ============================================================
// O formato dos arquivos públicos do CNPJ (Receita Federal) e como
// cada linha vira uma linha da nossa base. Puro, para ser testado
// (layout.test.mjs).
//
// Os arquivos são CSV sem cabeçalho, separados por ";", com os campos
// entre aspas e em ISO-8859-1. A ordem das colunas é a do "dicionário
// de dados" da Receita, conferida com os arquivos de 2026-11.
// ============================================================

/** Uma linha do CSV em campos. Aspas dobradas ("") viram uma aspa. */
export function parseLine(line) {
  const fields = []
  let i = 0
  const n = line.length
  while (i <= n) {
    if (line[i] === '"') {
      let value = ''
      i += 1
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"'
            i += 2
            continue
          }
          break
        }
        value += line[i]
        i += 1
      }
      fields.push(value)
      // Depois da aspa de fechamento vem ";" ou o fim.
      i = line.indexOf(';', i)
      if (i === -1) break
      i += 1
    } else {
      const end = line.indexOf(';', i)
      if (end === -1) {
        fields.push(line.slice(i))
        break
      }
      fields.push(line.slice(i, end))
      i = end + 1
    }
  }
  return fields
}

const digits = (v) => (v ?? '').replace(/\D/g, '')
const clean = (v) => {
  const s = (v ?? '').replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}

/** DDD + número, só dígitos, ou null quando não parece um telefone. */
export function phone(ddd, number) {
  const d = digits(ddd).replace(/^0+/, '')
  const num = digits(number)
  if (d.length !== 2 || (num.length !== 8 && num.length !== 9)) return null
  if (/^(\d)\1+$/.test(num)) return null
  return d + num
}

/**
 * Celular: 9 dígitos começando em 9, ou 8 dígitos começando em 7, 8 ou
 * 9 (cadastros de antes do nono dígito). O resto é fixo.
 */
export function isMobile(dddNumber) {
  if (!dddNumber) return false
  const local = dddNumber.slice(2)
  if (local.length === 9) return local[0] === '9'
  return local[0] === '7' || local[0] === '8' || local[0] === '9'
}

/** "20240315" → "2024-03-15"; vazio, zero ou data impossível → null. */
export function date(v) {
  const d = digits(v)
  if (d.length !== 8 || d === '00000000') return null
  const y = Number(d.slice(0, 4))
  const m = Number(d.slice(4, 6))
  const day = Number(d.slice(6, 8))
  if (y < 1800 || y > 2200 || m < 1 || m > 12 || day < 1 || day > 31) return null
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
}

/** "5000,00" → 5000; vazio → null. */
export function money(v) {
  const s = (v ?? '').trim().replace(/\./g, '').replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * A razão social de um MEI traz o CPF da pessoa no fim ("MARIA DA
 * SILVA 12345678900", "… 123.456.789-00", às vezes colado ao nome) ou o
 * número do CNPJ, no fim ou no começo ("12.345.678 MARIA DA SILVA").
 * Nenhum deles é guardado.
 */
export function stripPersonalNumber(name) {
  return (name ?? '')
    .replace(/\s*-?\s*\d{3}\.?\d{3}\.?\d{3}-?\d{2}\s*$/, '')
    .replace(/\s+(?:\d{2}\.\d{3}\.\d{3}|\d{8})\s*$/, '')
    .replace(/^\d{2}\.\d{3}\.\d{3}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function email(v) {
  const s = (v ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
}

/**
 * Os 8 primeiros caracteres do CNPJ como número, para caber num
 * Float64Array. Desde julho de 2026 eles podem ter letras, por isso a
 * base 36 (36^8 cabe com folga em 2^53).
 */
export function packBasico(basico) {
  const n = parseInt(basico, 36)
  return Number.isFinite(n) ? n : -1
}

/** Um conjunto grande de números, em memória contígua. */
export class NumberSet {
  constructor(capacity = 1 << 20) {
    this.values = new Float64Array(capacity)
    this.size = 0
    this.sealed = false
  }

  add(n) {
    if (this.size === this.values.length) {
      const bigger = new Float64Array(this.values.length * 2)
      bigger.set(this.values)
      this.values = bigger
    }
    this.values[this.size] = n
    this.size += 1
    this.sealed = false
  }

  /** Ordena e tira os repetidos; `has` só vale depois disto. */
  seal() {
    const sorted = this.values.subarray(0, this.size).sort()
    let w = 0
    for (let r = 0; r < sorted.length; r += 1) {
      if (r === 0 || sorted[r] !== sorted[r - 1]) {
        sorted[w] = sorted[r]
        w += 1
      }
    }
    this.size = w
    this.sealed = true
    return this
  }

  has(n) {
    if (!this.sealed) throw new Error('NumberSet: seal() antes de has()')
    let lo = 0
    let hi = this.size - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const v = this.values[mid]
      if (v === n) return true
      if (v < n) lo = mid + 1
      else hi = mid - 1
    }
    return false
  }
}

/** Situação cadastral "ativa". */
export const ATIVA = '02'

/**
 * Estabelecimentos: 30 colunas. Devolve null para quem não está ativo,
 * ou é de fora das UFs pedidas.
 */
export function estabelecimento(f, lote, ufs = null) {
  if (f.length < 28) return null
  if (f[5] !== ATIVA && f[5] !== '2') return null
  const uf = (f[19] ?? '').trim().toUpperCase()
  if (ufs && !ufs.has(uf)) return null
  const basico = (f[0] ?? '').trim().toUpperCase()
  const cnpj = basico + (f[1] ?? '').trim() + (f[2] ?? '').trim()
  if (basico.length !== 8 || cnpj.length !== 14) return null
  const telefone1 = phone(f[21], f[22])
  const telefone2 = phone(f[23], f[24])
  const street = [clean(f[13]), clean(f[14])].filter(Boolean).join(' ')
  const number = clean(f[15])
  const endereco = [
    [street, number && number !== 'S/N' && number !== 'SN' ? number : null].filter(Boolean).join(', '),
    clean(f[16]),
  ]
    .filter(Boolean)
    .join(' - ')
  const municipio = Number(digits(f[20]))
  return {
    cnpj,
    basico,
    matriz: (f[3] ?? '').trim() !== '2',
    nome_fantasia: clean(f[4]),
    abertura: date(f[10]),
    cnae: digits(f[11]) || null,
    endereco: endereco || null,
    bairro: clean(f[17]),
    cep: digits(f[18]) || null,
    uf: uf || null,
    municipio: Number.isFinite(municipio) && municipio > 0 ? municipio : null,
    telefone1,
    telefone2: telefone2 === telefone1 ? null : telefone2,
    email: email(f[27]),
    tem_celular: isMobile(telefone1) || isMobile(telefone2),
    lote,
  }
}

/** Empresas: 7 colunas. `mei` vem do arquivo do Simples. */
export function empresa(f, lote, mei) {
  if (f.length < 6) return null
  const basico = (f[0] ?? '').trim().toUpperCase()
  if (basico.length !== 8) return null
  const natureza = digits(f[2]) || null
  // 2135: empresário individual — a razão social é o nome da pessoa.
  const personal = mei || natureza === '2135'
  return {
    basico,
    razao_social: personal ? stripPersonalNumber(f[1]) : (clean(f[1]) ?? ''),
    natureza,
    porte: digits(f[5]) || null,
    capital: money(f[4]),
    mei: Boolean(mei),
    lote,
  }
}

/** Simples: o CNPJ básico quando a opção pelo MEI está em "S". */
export function meiBasico(f) {
  if (f.length < 5) return null
  return (f[4] ?? '').trim().toUpperCase() === 'S' ? (f[0] ?? '').trim().toUpperCase() : null
}

/**
 * Quem responde pela empresa: sócio-administrador (49), administrador
 * (05), empresário (50), titular (65), presidente (16) e diretor (10).
 */
const RESPONSAVEIS = new Set(['49', '05', '5', '50', '65', '16', '10'])

/** Sócios: 11 colunas. Só pessoa física com papel de quem responde. */
export function responsavel(f, lote) {
  if (f.length < 5) return null
  if ((f[1] ?? '').trim() !== '2') return null
  if (!RESPONSAVEIS.has((f[4] ?? '').trim())) return null
  const basico = (f[0] ?? '').trim().toUpperCase()
  const nome = clean(f[2])
  if (basico.length !== 8 || !nome) return null
  // O CPF mascarado (f[3]) fica de fora de propósito.
  return { basico, nome, lote }
}

export function cnae(f) {
  const codigo = digits(f[0])
  const descricao = clean(f[1])
  return codigo && descricao ? { codigo, descricao } : null
}

export function municipio(f) {
  const codigo = Number(digits(f[0]))
  const nome = clean(f[1])
  return codigo > 0 && nome ? { codigo, nome } : null
}
