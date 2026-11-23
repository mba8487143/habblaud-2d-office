// npm run desktop:install | desktop:uninstall — atalho "Habblaud" na área de trabalho do Windows.
// O atalho roda scripts/windows/habblaud.ps1 (PowerShell sem janela): sobe o servidor em segundo plano, se ainda não
// estiver rodando, e abre o app numa janela própria (Chrome ou Edge com --app). O ícone (habblaud.ico) é montado aqui a
// partir dos PNGs da marca e fica na pasta de dados (~/.habblaud). Só Windows por enquanto.
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

/** PowerShell que cria o atalho. Os caminhos chegam por variáveis de ambiente (sem montar aspas no comando). */
export const CREATE_SHORTCUT_PS = [
  "$desktop = [Environment]::GetFolderPath('Desktop')",
  `$path = Join-Path $desktop '${SHORTCUT_NAME}'`,
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)',
  '$s.TargetPath = $env:HB_POWERSHELL',
  "$s.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $env:HB_LAUNCHER + '\"'",
  '$s.WorkingDirectory = $env:HB_ROOT',
  "$s.IconLocation = $env:HB_ICON + ',0'",
  '$s.WindowStyle = 7',
  "$s.Description = 'Habblaud'",
  '$s.Save()',
  'Write-Output $path',
].join('; ');

/** PowerShell que apaga o atalho, só se ele for o do Habblaud (aponta para o habblaud.ps1). */
export const REMOVE_SHORTCUT_PS = [
  `$path = Join-Path ([Environment]::GetFolderPath('Desktop')) '${SHORTCUT_NAME}'`,
  'if (Test-Path -LiteralPath $path) {',
  '  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)',
  "  if ($s.Arguments -like '*habblaud.ps1*') { Remove-Item -LiteralPath $path -Force; Write-Output $path }",
  '}',
].join(' ');

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

function install(): number {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const icon = join(dir, 'habblaud.ico');
  writeFileSync(icon, buildIco(ICON_PNGS.map((f) => readFileSync(join(BRAND, f)))));
  const r = runPs(CREATE_SHORTCUT_PS, { HB_POWERSHELL: powershell(), HB_LAUNCHER: LAUNCHER, HB_ROOT: ROOT, HB_ICON: icon });
  if (!r.ok || !r.out) {
    console.error(tr('Não foi possível criar o atalho: {0}', [r.err || '?']));
    return 1;
  }
  console.log(tr('✓ Atalho criado: {0}', [r.out]));
  console.log(tr('Dê dois cliques nele: o Habblaud sobe em segundo plano (se ainda não estiver rodando) e abre numa janela própria.'));
  return 0;
}

function uninstall(): number {
  const r = runPs(REMOVE_SHORTCUT_PS);
  rmSync(join(dataDir(), 'habblaud.ico'), { force: true });
  if (r.out) console.log(tr('✓ Atalho removido: {0}', [r.out]));
  else console.log(tr('Nenhum atalho do Habblaud na área de trabalho.'));
  return r.ok ? 0 : 1;
}

function main(): void {
  const cmd = process.argv[2];
  if (cmd !== 'install' && cmd !== 'uninstall') {
    console.log(tr('Uso: npm run desktop:install (cria o atalho) ou npm run desktop:uninstall (apaga)'));
    process.exitCode = cmd === '-h' || cmd === '--help' ? 0 : 1;
    return;
  }
  if (process.platform !== 'win32') {
    console.log(tr('O atalho da área de trabalho por enquanto é só do Windows. Nos outros sistemas: npm start e abra http://localhost:4747.'));
    return;
  }
  if (!existsSync(LAUNCHER)) {
    console.error(tr('Não foi possível criar o atalho: {0}', [LAUNCHER]));
    process.exitCode = 1;
    return;
  }
  process.exitCode = cmd === 'install' ? install() : uninstall();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
