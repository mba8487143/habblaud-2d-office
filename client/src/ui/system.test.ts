import { describe, expect, it } from 'vitest';
import { batteryLevel, systemView } from './system';

const GIB = 2 ** 30;

describe('cartão Este computador', () => {
  it('CPU e memória com as cores do uso; bateria baixa em vermelho', () => {
    const v = systemView({
      cpu: { pct: 42, cores: 12 },
      mem: { pct: 81, usedBytes: 25.7 * GIB, totalBytes: 31.7 * GIB },
      battery: { pct: 12, charging: false, plugged: false },
      at: 0,
    });
    expect(v.cpu).toMatchObject({ pct: 42, level: 'ok', extra: '12 núcleos' });
    expect(v.mem).toMatchObject({ pct: 81, level: 'crit', extra: '25,7/31,7 GB' });
    expect(v.mem.title).toBe('Memória (RAM): 81% em uso, 25,7 de 31,7 GB');
    expect(v.battery).toMatchObject({ pct: 12, level: 'crit', extra: 'na bateria', title: 'Bateria: 12% (na bateria)' });
  });

  it('bateria na tomada ou carregando ganha o raio; sem bateria ou sem CPU, a linha some', () => {
    const base = { cpu: null, mem: { pct: 10, usedBytes: GIB, totalBytes: 10 * GIB }, at: 0 };
    expect(systemView({ ...base, battery: { pct: 100, charging: false, plugged: true } }).battery?.extra).toBe('⚡ na tomada');
    expect(systemView({ ...base, battery: { pct: 55, charging: true, plugged: true } }).battery?.extra).toBe('⚡ carregando');
    const none = systemView({ ...base, battery: null });
    expect(none.battery).toBeNull();
    expect(none.cpu).toBeNull();
  });

  it('nível da bateria: o perigo é o número baixo', () => {
    expect(batteryLevel(100)).toBe('ok');
    expect(batteryLevel(31)).toBe('ok');
    expect(batteryLevel(30)).toBe('warn');
    expect(batteryLevel(16)).toBe('warn');
    expect(batteryLevel(15)).toBe('crit');
  });
});
