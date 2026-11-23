// CPU, memória e bateria deste computador para a barra de cima (GET /api/system). Sem dependências: só o `os` do Node
// e, para a bateria, o que cada sistema já tem.
// - CPU: diferença dos tempos de os.cpus() entre duas leituras (a primeira leitura é feita ao criar, então a primeira
//   resposta já tem número).
// - Memória: os.totalmem() e os.freemem() (no Windows, a memória disponível).
// - Bateria, relida no máximo a cada `batteryTtlMs` (padrão 60 s), em segundo plano:
//   Windows: Win32_Battery pelo PowerShell (sem janela: windowsHide); macOS: `pmset -g batt`; Linux:
//   /sys/class/power_supply. Sem bateria (computador de mesa, Docker) ou com erro: null, e o cartão esconde a linha.
// Nada disso sai do computador: não entra no snapshot, na linha do tempo nem no pacote do Habblaud World.
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import type { SystemStats } from '../../shared/types';

export type Battery = NonNullable<SystemStats['battery']>;

interface CpuTimes {
  idle: number;
  total: number;
}

/** Soma dos tempos de todos os núcleos. */
export function cpuTimes(list: ReadonlyArray<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }>): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of list) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** Uso (0–100, inteiro) entre duas leituras; null se o tempo não andou. */
export function cpuPercent(prev: CpuTimes, next: CpuTimes): number | null {
  const total = next.total - prev.total;
  const idle = next.idle - prev.idle;
  if (!(total > 0)) return null;
  return Math.round(Math.min(100, Math.max(0, (1 - idle / total) * 100)));
}

const clampPct = (v: number) => Math.round(Math.min(100, Math.max(0, v)));

/**
 * Win32_Battery em JSON (`ConvertTo-Json`: um objeto, ou uma lista com mais de uma bateria). BatteryStatus: 1 =
 * descarregando; 2 = na tomada; 3 = carregada; 6–9 = carregando; o resto conta como na bateria.
 */
export function parseWindowsBattery(json: string): Battery | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const list = (Array.isArray(data) ? data : [data]).filter(
    (b): b is { EstimatedChargeRemaining: number; BatteryStatus?: number } =>
      !!b && typeof b === 'object' && typeof (b as { EstimatedChargeRemaining?: unknown }).EstimatedChargeRemaining === 'number',
  );
  if (!list.length) return null;
  const pct = clampPct(list.reduce((s, b) => s + b.EstimatedChargeRemaining, 0) / list.length);
  const statuses = list.map((b) => b.BatteryStatus ?? 0);
  const charging = statuses.some((s) => s >= 6 && s <= 9);
  const plugged = charging || statuses.some((s) => s === 2 || s === 3);
  return { pct, charging, plugged };
}

/** Saída do `pmset -g batt` (macOS): "Now drawing from 'AC Power'" e "-InternalBattery-0 (id=…)	84%; charging; …". */
export function parsePmset(out: string): Battery | null {
  const m = /(\d{1,3})%;\s*([a-z ]+?)\s*;/i.exec(out);
  if (!m) return null;
  const state = m[2].toLowerCase();
  const charging = state === 'charging' || state === 'finishing charge';
  const plugged = charging || /'AC Power'/i.test(out);
  return { pct: clampPct(Number(m[1])), charging, plugged };
}

/** /sys/class/power_supply (Linux): as baterias (BAT0...) com capacity e status; a tomada (AC, ADP1...) com online. */
export async function readLinuxBattery(dir = '/sys/class/power_supply'): Promise<Battery | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const read = (n: string, f: string) => readFile(join(dir, n, f), 'utf8').then((s) => s.trim()).catch(() => '');
  const levels: number[] = [];
  let charging = false;
  let plugged = false;
  for (const n of names) {
    const type = await read(n, 'type');
    if (type === 'Battery' || /^BAT/i.test(n)) {
      const cap = Number(await read(n, 'capacity'));
      if (!Number.isFinite(cap) || (await read(n, 'scope')) === 'Device') continue;
      levels.push(cap);
      const status = (await read(n, 'status')).toLowerCase();
      if (status === 'charging') charging = true;
      if (status === 'charging' || status === 'full' || status === 'not charging') plugged = true;
    } else if (type === 'Mains' || /^(AC|ADP)/i.test(n)) {
      if ((await read(n, 'online')) === '1') plugged = true;
    }
  }
  if (!levels.length) return null;
  return { pct: clampPct(levels.reduce((s, v) => s + v, 0) / levels.length), charging, plugged: plugged || charging };
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

/** Lê a bateria do jeito de cada sistema; null sem bateria ou se não deu para ler. */
export async function readBattery(platform: NodeJS.Platform = process.platform): Promise<Battery | null> {
  try {
    if (platform === 'win32') {
      const out = await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance -ClassName Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress'],
        8000,
      );
      return out.trim() ? parseWindowsBattery(out) : null;
    }
    if (platform === 'darwin') return parsePmset(await run('pmset', ['-g', 'batt'], 4000));
    if (platform === 'linux') return await readLinuxBattery();
  } catch {
    // Sem PowerShell/pmset, tempo esgotado ou erro: sem bateria.
  }
  return null;
}

export interface SystemStatsOptions {
  /** Releitura da bateria (ms). */
  batteryTtlMs?: number;
  /** Para os testes. */
  now?: () => number;
  cpus?: typeof cpus;
  totalmem?: () => number;
  freemem?: () => number;
  battery?: () => Promise<Battery | null>;
}

export class SystemStatsService {
  private prev: CpuTimes;
  private lastCpu: number | null = null;
  private lastCpuAt = 0;
  private battery: Battery | null = null;
  private batteryAt = -Infinity;
  private batteryPending: Promise<void> | null = null;
  private readonly o: Required<SystemStatsOptions>;

  constructor(opts: SystemStatsOptions = {}) {
    this.o = {
      batteryTtlMs: opts.batteryTtlMs ?? 60_000,
      now: opts.now ?? Date.now,
      cpus: opts.cpus ?? cpus,
      totalmem: opts.totalmem ?? totalmem,
      freemem: opts.freemem ?? freemem,
      battery: opts.battery ?? (() => readBattery()),
    };
    this.prev = cpuTimes(this.o.cpus());
    this.lastCpuAt = this.o.now();
    // A primeira leitura da bateria já começa agora, para a primeira resposta ter número.
    this.refreshBattery();
  }

  private refreshBattery(): Promise<void> {
    if (this.batteryPending) return this.batteryPending;
    this.batteryAt = this.o.now();
    this.batteryPending = this.o
      .battery()
      .catch(() => null)
      .then((b) => {
        this.battery = b;
      })
      .finally(() => {
        this.batteryPending = null;
      });
    return this.batteryPending;
  }

  /** Leitura de agora. A CPU conta desde a leitura anterior (no mínimo 500 ms, para não virar ruído). */
  read(): SystemStats {
    const now = this.o.now();
    const list = this.o.cpus();
    if (now - this.lastCpuAt >= 500) {
      const next = cpuTimes(list);
      const pct = cpuPercent(this.prev, next);
      if (pct !== null) this.lastCpu = pct;
      this.prev = next;
      this.lastCpuAt = now;
    }
    if (now - this.batteryAt >= this.o.batteryTtlMs) void this.refreshBattery();
    const total = this.o.totalmem();
    const free = Math.min(total, Math.max(0, this.o.freemem()));
    return {
      cpu: this.lastCpu === null ? null : { pct: this.lastCpu, cores: list.length },
      mem: { pct: total > 0 ? clampPct(((total - free) / total) * 100) : 0, usedBytes: total - free, totalBytes: total },
      battery: this.battery ? { ...this.battery } : null,
      at: now,
    };
  }

  /** Espera a leitura da bateria em andamento (testes e a primeira resposta). */
  async settled(): Promise<void> {
    await this.batteryPending;
  }
}
