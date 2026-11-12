import { describe, expect, it } from 'vitest';

import { personName } from './store';

describe('personName', () => {
  it('is the name as written, without stray spaces', () => {
    expect(personName('Ana Lima')).toBe('Ana Lima');
    expect(personName('  Ana   Lima \n')).toBe('Ana Lima');
  });

  it('is null when there is no name', () => {
    expect(personName('')).toBeNull();
    expect(personName('   ')).toBeNull();
    expect(personName(null)).toBeNull();
    expect(personName(undefined)).toBeNull();
  });
});
