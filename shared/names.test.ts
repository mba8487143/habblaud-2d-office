import { describe, expect, it } from 'vitest';
import { NAME_POOL, OFFICE_NAME_POOL, pickName, pickOfficeName } from './names';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

describe('nomes dos personagens', () => {
  it('escritório: 120 nomes paquistaneses, sem repetição, metade de cada look', () => {
    expect(OFFICE_NAME_POOL).toHaveLength(120);
    expect(new Set(OFFICE_NAME_POOL.map((p) => fold(p.name))).size).toBe(120);
    expect(OFFICE_NAME_POOL.filter((p) => p.look === 'f')).toHaveLength(60);
  });

  it('o Habblaud World continua com a lista original (o servidor do mundo confere o pacote contra ela)', () => {
    expect(NAME_POOL).toHaveLength(120);
    expect(NAME_POOL.slice(0, 4).map((p) => p.name)).toEqual(['Ana', 'Arthur', 'Beatriz', 'Bruno']);
    const office = new Set(OFFICE_NAME_POOL.map((p) => fold(p.name)));
    expect(NAME_POOL.filter((p) => office.has(fold(p.name)))).toEqual([]);
  });

  it('cada lista sorteia só os próprios nomes', () => {
    const office = new Set(OFFICE_NAME_POOL.map((p) => p.name));
    const world = new Set(NAME_POOL.map((p) => p.name));
    for (const id of ['a', 'b', 'sessao-1', 'x'.repeat(40)]) {
      expect(office.has(pickOfficeName(id, new Set()).name)).toBe(true);
      expect(world.has(pickName(id, new Set()).name)).toBe(true);
    }
  });
});
