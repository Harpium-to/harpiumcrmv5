import { describe, expect, it } from 'vitest';

import { fillQuickReply } from './variables';

describe('fillQuickReply', () => {
  const maria = { name: 'Maria Souza Lima', company: 'Clínica Sol' };

  it('fills the three variables', () => {
    expect(
      fillQuickReply('Olá {{primeiro_nome}}! Falo com {{nome}}, da {{empresa}}?', maria)
    ).toEqual({
      text: 'Olá Maria! Falo com Maria Souza Lima, da Clínica Sol?',
      missing: [],
    });
  });

  it('accepts spaces inside the braces and any capitalisation', () => {
    expect(fillQuickReply('Oi {{ Nome }} / {{PRIMEIRO_NOME}}', maria).text).toBe(
      'Oi Maria Souza Lima / Maria'
    );
  });

  it('leaves a text without variables exactly as it is', () => {
    const text = 'Nosso horário é das 8h às 18h :)\n\nQualquer coisa , chame.';
    expect(fillQuickReply(text, maria)).toEqual({ text, missing: [] });
  });

  it('takes out a variable with no value and closes the gap', () => {
    expect(fillQuickReply('Olá {{primeiro_nome}}, tudo bem?', {})).toEqual({
      text: 'Olá, tudo bem?',
      missing: ['primeiro_nome'],
    });
    expect(fillQuickReply('Olá {{nome}} tudo bem?', {}).text).toBe('Olá tudo bem?');
    expect(fillQuickReply('Obrigado, {{nome}}', {}).text).toBe('Obrigado,');
    expect(fillQuickReply('Obrigado {{nome}}!', {}).text).toBe('Obrigado!');
  });

  it('tidies a line that began with a missing variable', () => {
    expect(fillQuickReply('{{nome}}, bom dia!\n{{empresa}} confirmou?', {})).toEqual({
      text: 'bom dia!\nconfirmou?',
      missing: ['nome', 'empresa'],
    });
  });

  it('reports each missing variable once, in a fixed order', () => {
    expect(
      fillQuickReply('{{empresa}} {{nome}} {{empresa}} {{primeiro_nome}}', {}).missing
    ).toEqual(['nome', 'primeiro_nome', 'empresa']);
    expect(fillQuickReply('{{nome}} da {{empresa}}', { name: 'Ana' })).toEqual({
      text: 'Ana da',
      missing: ['empresa'],
    });
  });

  it('treats a name that is only a phone number as no name', () => {
    for (const name of ['5531999998888', '+55 (31) 99999-8888', '   ', null, undefined]) {
      expect(fillQuickReply('Olá {{primeiro_nome}}!', { name })).toEqual({
        text: 'Olá!',
        missing: ['primeiro_nome'],
      });
    }
    expect(fillQuickReply('Olá {{primeiro_nome}}!', { name: 'Loja 24h' }).text).toBe('Olá Loja!');
  });

  it('leaves braces it does not know alone', () => {
    expect(fillQuickReply('Oi {{vars.name}} e {{sobrenome}} e {nome}', maria)).toEqual({
      text: 'Oi {{vars.name}} e {{sobrenome}} e {nome}',
      missing: [],
    });
  });

  it('copes with nothing', () => {
    expect(fillQuickReply('', maria)).toEqual({ text: '', missing: [] });
    expect(fillQuickReply(undefined as unknown as string, maria)).toEqual({ text: '', missing: [] });
  });
});
