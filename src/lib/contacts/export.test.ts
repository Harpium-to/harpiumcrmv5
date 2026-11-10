import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/reports/csv';

import { EXPORT_COLUMNS, parseExportFilters, type ExportRow } from './export';

describe('parseExportFilters', () => {
  it('takes the search and the tags the screen sends', () => {
    const url = new URL(
      'https://crm/api/contacts/export?search=%20ana%20&tags=11111111-2222-3333-4444-555555555555,lixo',
    );
    expect(parseExportFilters(url)).toEqual({
      search: 'ana',
      tagIds: ['11111111-2222-3333-4444-555555555555'],
    });
  });

  it('is no filter at all when nothing is sent', () => {
    expect(parseExportFilters(new URL('https://crm/api/contacts/export'))).toEqual({
      search: null,
      tagIds: [],
    });
  });
});

describe('EXPORT_COLUMNS', () => {
  it('writes a row the way a person reads it', () => {
    const row: ExportRow = {
      id: 'c1',
      name: 'Ana Lima',
      phone: '+5511999998888',
      email: 'ana@x.com',
      company: '=SOMA(1)',
      temperature: 'hot',
      created_at: '2026-11-10T15:00:00Z',
      tags: ['Indicação', 'VIP'],
      stage: 'Proposta enviada',
    };
    const lines = toCsv([row], EXPORT_COLUMNS).replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe(
      'Nome,Telefone,Email,Empresa,Temperatura,Etiquetas,Etapa do negócio,Não quer receber,Criado em',
    );
    // The shared CSV helper defuses cells that a spreadsheet would read
    // as a formula — "+" included, so phones keep a leading apostrophe,
    // as in the agency's export.
    expect(lines[1]).toContain("Ana Lima,'+5511999998888,ana@x.com");
    expect(lines[1]).toContain('Quente,"Indicação, VIP",Proposta enviada,,10/11/2026');
    expect(toCsv([{ ...row, opted_out_at: '2026-11-10T15:00:00Z' }], EXPORT_COLUMNS)).toContain(
      'Proposta enviada,Sim,',
    );
    expect(lines[1]).toContain(",'=SOMA(1),");
  });
});
