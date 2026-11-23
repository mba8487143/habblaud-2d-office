// Cartão "Este computador" na barra de cima: CPU, memória e bateria do computador que roda o Habblaud (GET
// /api/system, server/system/stats.ts). Mesmo visual dos cartões de uso (ui/usage.ts), com um ícone no lugar do chip.
// - Pergunta a cada POLL_MS só com a aba visível; some no modo simulação (?mock=1) e quando a rota não responde.
// - Cores: CPU e memória como o uso (verde, amarelo a partir de 50%, vermelho a partir de 80%); a bateria ao contrário
//   (amarelo até 30%, vermelho até 15%). Sem bateria (computador de mesa), a linha da bateria some.
import type { SystemStats } from '../../../shared/types';
import { intlLocale, tr } from '../../../shared/i18n';
import type { UiContext } from './context';
import { h, setAttr, setHidden, setStyleVar, setText, setTitle, setVariant } from './dom';
import { usageLevel, type UsageLevel } from './format';

export const POLL_MS = 3000;
/** Respostas seguidas com erro até o cartão sumir (um soluço da rede não pisca o cartão). */
const MAX_FAILURES = 3;

export interface SystemRowView {
  pct: number;
  level: UsageLevel;
  /** Texto da última coluna ("12 núcleos", "13,9/31,7 GB", "⚡ carregando"). */
  extra: string;
  /** Frase completa (dica e leitor de tela). */
  title: string;
}

export interface SystemView {
  cpu: SystemRowView | null;
  mem: SystemRowView;
  battery: SystemRowView | null;
}

/** Bateria: o perigo é o número baixo. */
export function batteryLevel(pct: number): UsageLevel {
  if (pct <= 15) return 'crit';
  if (pct <= 30) return 'warn';
  return 'ok';
}

const GIB = 2 ** 30;

export function systemView(s: SystemStats): SystemView {
  const gb = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const cpu = s.cpu
    ? {
        pct: s.cpu.pct,
        level: usageLevel(s.cpu.pct),
        extra: tr('{0} núcleos', [s.cpu.cores]),
        title: tr('Processador (CPU): {0}% em uso', [s.cpu.pct]),
      }
    : null;
  const used = gb.format(s.mem.usedBytes / GIB);
  const total = gb.format(s.mem.totalBytes / GIB);
  const mem = {
    pct: s.mem.pct,
    level: usageLevel(s.mem.pct),
    extra: `${used}/${total} GB`,
    title: tr('Memória (RAM): {0}% em uso, {1} de {2} GB', [s.mem.pct, used, total]),
  };
  let battery: SystemRowView | null = null;
  if (s.battery) {
    const b = s.battery;
    const state = b.charging ? tr('carregando') : b.plugged ? tr('na tomada') : tr('na bateria');
    battery = {
      pct: b.pct,
      level: batteryLevel(b.pct),
      extra: b.plugged ? `⚡ ${state}` : state,
      title: tr('Bateria: {0}% ({1})', [b.pct, state]),
    };
  }
  return { cpu, mem, battery };
}

interface Row {
  el: HTMLElement;
  bar: HTMLElement;
  pct: HTMLElement;
  extra: HTMLElement;
}

function createRow(label: string): Row {
  const bar = h('span', { class: 'ui-meter__bar' }, h('span', { class: 'ui-meter__fill' }));
  const pct = h('span', { class: 'ui-meter__pct' });
  const extra = h('span', { class: 'ui-meter__reset' });
  const el = h('div', { class: 'ui-meter', role: 'img' }, h('span', { class: 'ui-meter__label', text: label }), bar, pct, extra);
  return { el, bar, pct, extra };
}

function updateRow(r: Row, v: SystemRowView | null): void {
  setHidden(r.el, !v);
  if (!v) return;
  setVariant(r.el, 'is-', v.level);
  r.el.classList.toggle('is-zero', v.pct === 0);
  setStyleVar(r.bar, '--pct', String(v.pct));
  setText(r.pct, `${v.pct}%`);
  setText(r.extra, v.extra);
  setAttr(r.el, 'aria-label', v.title);
  setTitle(r.el, v.title);
}

/** Ícone de monitor em pixel art (mesmo traço dos outros ícones da barra). */
const MONITOR_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true">' +
  '<path fill="currentColor" fill-rule="evenodd" d="M1 2h14v9H1zM2 3v7h12V3z"/>' +
  '<path fill="currentColor" opacity=".45" d="M3 4h10v5H3z"/>' +
  '<path fill="currentColor" d="M6 12h4v1h2v1H4v-1h2z"/></svg>';

export class SystemCard {
  readonly el: HTMLElement;
  private cpu = createRow('CPU');
  private mem = createRow('RAM');
  private battery = createRow(tr('Bateria'));
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private inFlight = false;

  constructor(
    private ctx: UiContext,
    private fetchStats: () => Promise<SystemStats> = async () => {
      const res = await fetch('/api/system', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SystemStats;
    },
  ) {
    const icon = h('span', { class: 'ui-sys-card__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = MONITOR_ICON;
    const meters = h('div', { class: 'ui-usage-card__meters' }, this.cpu.el, this.mem.el, this.battery.el);
    const card = h(
      'div',
      {
        class: 'ui-usage-card ui-sys-card',
        role: 'group',
        title: tr('Este computador: CPU, memória e bateria do computador que roda o Habblaud'),
        attrs: { 'aria-label': tr('Este computador') },
      },
      icon,
      h('div', { class: 'ui-usage-card__body' }, meters),
    );
    // Invólucro próprio: as regras da barra que contam as contas por `.ui-usage-card:nth-child(n)` não contam este.
    this.el = h('div', { class: 'ui-sys', hidden: true }, card);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.schedule(0));
    this.schedule(0);
  }

  private visible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.visible()) return;
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    if (this.ctx.store.mock) {
      setHidden(this.el, true);
      return;
    }
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      this.render(systemView(await this.fetchStats()));
      this.failures = 0;
    } catch {
      if (++this.failures >= MAX_FAILURES) setHidden(this.el, true);
    } finally {
      this.inFlight = false;
      this.schedule(POLL_MS);
    }
  }

  render(v: SystemView): void {
    updateRow(this.cpu, v.cpu);
    updateRow(this.mem, v.mem);
    updateRow(this.battery, v.battery);
    setHidden(this.el, false);
  }
}
