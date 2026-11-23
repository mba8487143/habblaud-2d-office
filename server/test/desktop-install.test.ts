import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIco, CREATE_SHORTCUT_PS, launcherArgs, pngSize, REMOVE_SHORTCUT_PS } from '../../scripts/desktop-install';

const BRAND = join(__dirname, '..', '..', 'client', 'public', 'assets', 'brand');
const png = (f: string) => readFileSync(join(BRAND, f));

describe('desktop:install', () => {
  it('lê o tamanho dos PNGs da marca', () => {
    expect(pngSize(png('favicon-16.png'))).toEqual({ width: 16, height: 16 });
    expect(pngSize(png('icon-192.png'))).toEqual({ width: 192, height: 192 });
    expect(() => pngSize(Buffer.from('não é png'))).toThrow();
  });

  it('monta o .ico com os PNGs dentro, cada entrada apontando para os próprios bytes', () => {
    const pngs = [png('favicon-16.png'), png('favicon-32.png'), png('icon-192.png')];
    const ico = buildIco(pngs);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    pngs.forEach((p, i) => {
      const e = 6 + i * 16;
      expect(ico.readUInt8(e)).toBe(pngSize(p).width);
      expect(ico.readUInt16LE(e + 6)).toBe(32);
      const size = ico.readUInt32LE(e + 8);
      const offset = ico.readUInt32LE(e + 12);
      expect(size).toBe(p.length);
      expect(ico.subarray(offset, offset + size).equals(p)).toBe(true);
    });
    expect(() => buildIco([png('icon-512.png')])).toThrow();
  });

  it('o atalho chama o habblaud.ps1 sem janela, na pasta pedida; a remoção só apaga o atalho do Habblaud', () => {
    expect(CREATE_SHORTCUT_PS).toContain('-WindowStyle Hidden -File');
    expect(CREATE_SHORTCUT_PS).toContain('$env:HB_LAUNCHER');
    expect(CREATE_SHORTCUT_PS).toContain('GetFolderPath($env:HB_PLACE)');
    expect(CREATE_SHORTCUT_PS).toContain('$env:HB_EXTRA');
    expect(REMOVE_SHORTCUT_PS).toContain('GetFolderPath($env:HB_PLACE)');
    expect(REMOVE_SHORTCUT_PS).toContain("-like '*habblaud.ps1*'");
  });

  it('início automático: só sobe o servidor, a não ser com --open; o da área de trabalho sempre abre a janela', () => {
    expect(launcherArgs('Startup', false)).toBe('-NoOpen');
    expect(launcherArgs('Startup', true)).toBe('');
    expect(launcherArgs('Desktop', false)).toBe('');
  });
});
