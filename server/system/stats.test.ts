import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cpuPercent, cpuTimes, parsePmset, parseWindowsBattery, readLinuxBattery, SystemStatsService } from './stats';

const core = (busy: number, idle: number) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

describe('CPU', () => {
  it('soma os núcleos e calcula o uso entre duas leituras', () => {
    const a = cpuTimes([core(100, 900), core(100, 900)]);
    const b = cpuTimes([core(400, 1100), core(200, 1300)]);
    // ocupado +400, ocioso +600 -> 40%
    expect(cpuPercent(a, b)).toBe(40);
  });

  it('sem tempo entre as leituras: null', () => {
    const a = cpuTimes([core(1, 1)]);
    expect(cpuPercent(a, a)).toBeNull();
  });
});

describe('bateria', () => {
  it('Windows: um objeto ou uma lista (média), carregando e na tomada', () => {
    expect(parseWindowsBattery('{"EstimatedChargeRemaining":100,"BatteryStatus":2}')).toEqual({ pct: 100, charging: false, plugged: true });
    expect(parseWindowsBattery('{"EstimatedChargeRemaining":37,"BatteryStatus":1}')).toEqual({ pct: 37, charging: false, plugged: false });
    expect(parseWindowsBattery('[{"EstimatedChargeRemaining":40,"BatteryStatus":6},{"EstimatedChargeRemaining":60,"BatteryStatus":1}]')).toEqual({
      pct: 50,
      charging: true,
      plugged: true,
    });
    expect(parseWindowsBattery('')).toBeNull();
    expect(parseWindowsBattery('{"Foo":1}')).toBeNull();
  });

  it('macOS: pmset -g batt', () => {
    const ac = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t84%; charging; 0:42 remaining present: true";
    const batt = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t61%; discharging; 3:10 remaining present: true";
    const full = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t100%; charged; 0:00 remaining present: true";
    expect(parsePmset(ac)).toEqual({ pct: 84, charging: true, plugged: true });
    expect(parsePmset(batt)).toEqual({ pct: 61, charging: false, plugged: false });
    expect(parsePmset(full)).toEqual({ pct: 100, charging: false, plugged: true });
    expect(parsePmset("Now drawing from 'AC Power'")).toBeNull();
  });

  describe('Linux: /sys/class/power_supply', () => {
    let dir = '';
    afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
    const supply = (name: string, files: Record<string, string>) => {
      mkdirSync(join(dir, name), { recursive: true });
      for (const [f, v] of Object.entries(files)) writeFileSync(join(dir, name, f), `${v}\n`);
    };

    it('lê a bateria e a tomada; ignora a bateria de um mouse', async () => {
      dir = mkdtempSync(join(tmpdir(), 'habblaud-power-'));
      supply('BAT0', { type: 'Battery', capacity: '72', status: 'Discharging' });
      supply('AC', { type: 'Mains', online: '1' });
      supply('hidpp_battery_0', { type: 'Battery', capacity: '5', status: 'Discharging', scope: 'Device' });
      expect(await readLinuxBattery(dir)).toEqual({ pct: 72, charging: false, plugged: true });
    });

    it('sem bateria (ou sem a pasta): null', async () => {
      dir = mkdtempSync(join(tmpdir(), 'habblaud-power-'));
      supply('AC', { type: 'Mains', online: '1' });
      expect(await readLinuxBattery(dir)).toBeNull();
      expect(await readLinuxBattery(join(dir, 'nao-existe'))).toBeNull();
    });
  });
});

describe('SystemStatsService', () => {
  it('CPU desde a leitura anterior, memória em uso e bateria guardada por um tempo', async () => {
    let now = 1_000;
    let busy = 100;
    let idle = 900;
    let batteryReads = 0;
    const s = new SystemStatsService({
      now: () => now,
      cpus: () => [core(busy, idle)] as never,
      totalmem: () => 16 * 2 ** 30,
      freemem: () => 4 * 2 ** 30,
      battery: async () => {
        batteryReads++;
        return { pct: 90, charging: false, plugged: true };
      },
      batteryTtlMs: 60_000,
    });
    await s.settled();
    // Logo em seguida: ainda sem número de CPU.
    expect(s.read().cpu).toBeNull();
    now += 3_000;
    busy += 300;
    idle += 700;
    const r = s.read();
    expect(r.cpu).toEqual({ pct: 30, cores: 1 });
    expect(r.mem).toEqual({ pct: 75, usedBytes: 12 * 2 ** 30, totalBytes: 16 * 2 ** 30 });
    expect(r.battery).toEqual({ pct: 90, charging: false, plugged: true });
    expect(batteryReads).toBe(1);
    now += 61_000;
    s.read();
    await s.settled();
    expect(batteryReads).toBe(2);
  });

  it('sem bateria: null', async () => {
    const s = new SystemStatsService({ battery: async () => null });
    await s.settled();
    expect(s.read().battery).toBeNull();
  });
});
