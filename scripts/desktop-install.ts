// Atalhos do Habblaud no Windows:
// - npm run desktop:install | desktop:uninstall — atalho "Habblaud" na área de trabalho: sobe o servidor em segundo
//   plano, se ainda não estiver rodando, e abre o app numa janela própria (Chrome ou Edge com --app);
// - npm run autostart:install | autostart:uninstall — o mesmo atalho na pasta Inicializar do Windows: ao entrar no
//   Windows, o servidor sobe sozinho, sem janela (`-- --open` abre a janela também). Aparece (e pode ser desligado) em
//   Gerenciador de Tarefas › Aplicativos de inicialização.
// Os atalhos rodam scripts/windows/habblaud.ps1 (PowerShell sem janela). O ícone (habblaud.ico) é montado aqui a partir
// dos PNGs da marca e fica na pasta de dados (~/.habblaud). Só Windows por enquanto.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tr } from '../shared/i18n';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = join(ROOT, 'scripts', 'windows', 'habblaud.ps1');
const BRAND = join(ROOT, 'client', 'public', 'assets', 'brand');
/** Os tamanhos do ícone: o Windows escolhe o mais próximo (área de trabalho, barra de tarefas, Alt+Tab). */
const ICON_PNGS = ['favicon-16.png', 'favicon-32.png', 'icon-192.png'];
const SHORTCUT_NAME = 'Habblaud.lnk';

/** Onde fica cada atalho: nome da pasta especial do Windows ([Environment]::GetFolderPath). */
export type ShortcutPlace = 'Desktop' | 'Startup';

/** Largura e altura de um PNG (cabeçalho IHDR). */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.toString('ascii', 12, 16) !== 'IHDR') throw new Error('not a PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Arquivo .ico com os PNGs dentro (formato aceito desde o Windows Vista): cabeçalho, uma entrada por PNG e os dados. */
export function buildIco(pngs: readonly Buffer[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * pngs.length;
  for (const png of pngs) {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256) throw new Error('icon larger than 256 px');
    const e = Buffer.alloc(16);
    e.writeUInt8(width === 256 ? 0 : width, 0);
    e.writeUInt8(height === 256 ? 0 : height, 1);
    e.writeUInt8(0, 2); // cores da paleta (nenhuma)
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

/**
 * PowerShell que cria um atalho. Tudo chega por variáveis de ambiente (sem montar aspas no comando): HB_PLACE (pasta
 * especial), HB_NAME, HB_POWERSHELL, HB_LAUNCHER, HB_EXTRA (argumentos a mais do habblaud.ps1), HB_ROOT e HB_ICON.
 */
export const CREATE_SHORTCUT_PS = [
  '$dir = [Environment]::GetFolderPath($env:HB_PLACE)',
  'if (-not $dir) { throw "no folder for $($env:HB_PLACE)" }',
  'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
  '$path = Join-Path $dir $env:HB_NAME',
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)',
  '$s.TargetPath = $env:HB_POWERSHELL',
  "$s.Arguments = ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $env:HB_LAUNCHER + '\" ' + $env:HB_EXTRA).Trim()",
  '$s.WorkingDirectory = $env:HB_ROOT',
  "$s.IconLocation = $env:HB_ICON + ',0'",
  '$s.WindowStyle = 7',
  "$s.Description = 'Habblaud'",
  '$s.Save()',
  'Write-Output $path',
].join('; ');

/** PowerShell que apaga um atalho (HB_PLACE, HB_NAME), só se ele for o do Habblaud (aponta para o habblaud.ps1). */
export const REMOVE_SHORTCUT_PS = [
  '$path = Join-Path ([Environment]::GetFolderPath($env:HB_PLACE)) $env:HB_NAME',
  'if (Test-Path -LiteralPath $path) {',
  '  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)',
  "  if ($s.Arguments -like '*habblaud.ps1*') { Remove-Item -LiteralPath $path -Force; Write-Output $path }",
  '}',
].join(' ');

/** Argumentos a mais do habblaud.ps1 em cada atalho: o da inicialização só sobe o servidor, a não ser com --open. */
export function launcherArgs(place: ShortcutPlace, open: boolean): string {
  return place === 'Startup' && !open ? '-NoOpen' : '';
}

function powershell(): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function runPs(script: string, env: Record<string, string> = {}): { ok: boolean; out: string; err: string } {
  // -EncodedCommand (UTF-16LE em base64): nada de aspas para escapar na linha de comando.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const r = spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() || (r.error?.message ?? '') };
}

function dataDir(): string {
  return resolve(process.env.HABBLAUD_DATA_DIR?.trim() || join(homedir(), '.habblaud'));
}

function iconPath(): string {
  return join(dataDir(), 'habblaud.ico');
}

/** Grava o ícone (sempre: os PNGs da marca podem ter mudado) e cria o atalho. Devolve o caminho ou o erro. */
function createShortcut(place: ShortcutPlace, open: boolean): { path?: string; error?: string } {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(iconPath(), buildIco(ICON_PNGS.map((f) => readFileSync(join(BRAND, f)))));
  const r = runPs(CREATE_SHORTCUT_PS, {
    HB_PLACE: place,
    HB_NAME: SHORTCUT_NAME,
    HB_POWERSHELL: powershell(),
    HB_LAUNCHER: LAUNCHER,
    HB_EXTRA: launcherArgs(place, open),
    HB_ROOT: ROOT,
    HB_ICON: iconPath(),
  });
  return r.ok && r.out ? { path: r.out } : { error: r.err || '?' };
}

function removeShortcut(place: ShortcutPlace): { removed?: string; ok: boolean } {
  const r = runPs(REMOVE_SHORTCUT_PS, { HB_PLACE: place, HB_NAME: SHORTCUT_NAME });
  return { removed: r.out || undefined, ok: r.ok };
}

function desktopInstall(): number {
  const r = createShortcut('Desktop', true);
  if (!r.path) {
    console.error(tr('Não foi possível criar o atalho: {0}', [r.error ?? '?']));
    return 1;
  }
  console.log(tr('✓ Atalho criado: {0}', [r.path]));
  console.log(tr('Dê dois cliques nele: o Habblaud sobe em segundo plano (se ainda não estiver rodando) e abre numa janela própria.'));
  return 0;
}

function desktopUninstall(): number {
  const r = removeShortcut('Desktop');
  // O ícone ainda serve ao atalho da inicialização, se houver.
  if (!shortcutExists('Startup')) rmSync(iconPath(), { force: true });
  if (r.removed) console.log(tr('✓ Atalho removido: {0}', [r.removed]));
  else console.log(tr('Nenhum atalho do Habblaud na área de trabalho.'));
  return r.ok ? 0 : 1;
}

function autostartInstall(open: boolean): number {
  const r = createShortcut('Startup', open);
  if (!r.path) {
    console.error(tr('Não foi possível ligar o início automático: {0}', [r.error ?? '?']));
    return 1;
  }
  console.log(tr('✓ Início automático ligado: {0}', [r.path]));
  console.log(
    open
      ? tr('Quando você entrar no Windows, o Habblaud sobe sozinho e abre o escritório numa janela própria.')
      : tr('Quando você entrar no Windows, o servidor do Habblaud sobe sozinho em segundo plano (sem abrir janela). Para abrir o escritório, use o ícone da área de trabalho.'),
  );
  return 0;
}

function autostartUninstall(): number {
  const r = removeShortcut('Startup');
  if (r.removed) console.log(tr('✓ Início automático desligado: {0}', [r.removed]));
  else console.log(tr('O início automático já estava desligado.'));
  return r.ok ? 0 : 1;
}

/** O atalho existe naquela pasta? (Para não apagar o ícone que o outro atalho ainda usa.) */
function shortcutExists(place: ShortcutPlace): boolean {
  const r = runPs(`if (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath($env:HB_PLACE)) $env:HB_NAME)) { 'yes' }`, {
    HB_PLACE: place,
    HB_NAME: SHORTCUT_NAME,
  });
  return r.out === 'yes';
}

const COMMANDS = ['desktop:install', 'desktop:uninstall', 'autostart:install', 'autostart:uninstall'] as const;
type Command = (typeof COMMANDS)[number];
const isCommand = (v: string | undefined): v is Command => !!v && (COMMANDS as readonly string[]).includes(v);

function main(): void {
  const arg = process.argv[2];
  const open = process.argv.includes('--open');
  if (!isCommand(arg)) {
    console.log(tr('Uso: npm run desktop:install (cria o atalho) ou npm run desktop:uninstall (apaga)'));
    console.log(tr('Início automático: npm run autostart:install (ou -- --open, para abrir a janela também) e npm run autostart:uninstall'));
    process.exitCode = arg === '-h' || arg === '--help' ? 0 : 1;
    return;
  }
  const cmd = arg;
  if (process.platform !== 'win32') {
    console.log(tr('O atalho da área de trabalho por enquanto é só do Windows. Nos outros sistemas: npm start e abra http://localhost:4747.'));
    return;
  }
  if (!existsSync(LAUNCHER)) {
    console.error(tr('Não foi possível criar o atalho: {0}', [LAUNCHER]));
    process.exitCode = 1;
    return;
  }
  const run: Record<Command, () => number> = {
    'desktop:install': desktopInstall,
    'desktop:uninstall': desktopUninstall,
    'autostart:install': () => autostartInstall(open),
    'autostart:uninstall': autostartUninstall,
  };
  process.exitCode = run[cmd]();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
