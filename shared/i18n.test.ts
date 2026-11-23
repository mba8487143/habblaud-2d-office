import { afterEach, describe, expect, it } from 'vitest';
import { baseLocale, getLocale, intlLocale, normalizeLocale, registerDictionary, serverLocale, setLocale, tr } from './i18n';
import { EN } from './locales/en';
import { ES } from './locales/es';
import { FR } from './locales/fr';
import { UR } from './locales/ur';

const placeholders = (s: string) => new Set(s.match(/\{\w+\}/g) ?? []);

describe('i18n', () => {
  afterEach(() => setLocale('pt-BR'));

  it('os testes rodam em PT, qualquer que seja o idioma da máquina', () => {
    expect(getLocale()).toBe('pt-BR');
  });

  it('reconhece os formatos de idioma do navegador e do sistema', () => {
    expect(normalizeLocale('fr')).toBe('fr');
    expect(normalizeLocale('fr-CA')).toBe('fr');
    expect(normalizeLocale('fr_FR.UTF-8')).toBe('fr');
    expect(normalizeLocale('pt')).toBe('pt-BR');
    expect(normalizeLocale('pt_PT')).toBe('pt-BR');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('es_AR.UTF-8')).toBe('es');
    expect(normalizeLocale('ur')).toBe('ur-Latn');
    expect(normalizeLocale('ur-PK')).toBe('ur-Latn');
    expect(normalizeLocale('ur-Latn')).toBe('ur-Latn');
    expect(normalizeLocale('ur_PK.UTF-8')).toBe('ur-Latn');
    expect(normalizeLocale('de-DE')).toBeUndefined();
    expect(normalizeLocale('')).toBeUndefined();
    expect(normalizeLocale(null)).toBeUndefined();
  });

  it('em PT devolve o próprio texto, com as lacunas preenchidas', () => {
    expect(tr('Lendo {0}', ['app.ts'])).toBe('Lendo app.ts');
    expect(tr('Texto que ninguém traduziu')).toBe('Texto que ninguém traduziu');
  });

  it('em francês traduz e pode reordenar as lacunas', () => {
    setLocale('fr');
    expect(tr('Lendo {0}', ['app.ts'])).toBe('Lit app.ts');
    expect(tr('Texto que ninguém traduziu')).toBe('Texto que ninguém traduziu');
    expect(intlLocale()).toBe('fr-FR');
  });

  it('lacunas sem argumento ficam como estão (as nomeadas são preenchidas por quem chama)', () => {
    expect(tr('Ganhei de {a} a {b}! 🏆')).toBe('Ganhei de {a} a {b}! 🏆');
    expect(tr('{0} e {1}', ['um'])).toBe('um e {1}');
  });

  it('servidor: HABBLAUD_LANG vale para qualquer idioma; do sistema, o inglês não conta', () => {
    expect(serverLocale({ HABBLAUD_LANG: 'en' }, 'pt-BR')).toBe('en');
    expect(serverLocale({ HABBLAUD_LANG: 'es-MX', LANG: 'fr_FR.UTF-8' })).toBe('es');
    // Mac com LANG em inglês e o container sem LANG (Intl en-US): o escritório fica em português.
    expect(serverLocale({ LANG: 'en_US.UTF-8' }, 'en-US')).toBe('pt-BR');
    expect(serverLocale({}, 'en-US')).toBe('pt-BR');
    expect(serverLocale({ LANG: 'en_US.UTF-8' }, 'pt-BR')).toBe('pt-BR');
    expect(serverLocale({ LANG: 'fr_FR.UTF-8' })).toBe('fr');
    expect(serverLocale({ LC_ALL: 'es_ES.UTF-8', LANG: 'en_US.UTF-8' })).toBe('es');
    expect(serverLocale({}, 'es-AR')).toBe('es');
  });

  it('inglês e espanhol traduzem e usam o formato de data do idioma', () => {
    setLocale('en');
    expect(intlLocale()).toBe('en-US');
    setLocale('es');
    expect(intlLocale()).toBe('es');
  });

  it('Roman Urdu: traduz, cai no inglês (não no PT) quando falta tradução e usa datas do Paquistão', () => {
    setLocale('ur-Latn');
    expect(tr('Lendo {0}', ['app.ts'])).toBe(UR['Lendo {0}'].replace('{0}', 'app.ts'));
    expect(tr('Lendo {0}', ['app.ts'])).not.toBe(EN['Lendo {0}'].replace('{0}', 'app.ts'));
    expect(intlLocale()).toBe('en-PK');
    try {
      registerDictionary('ur-Latn', {});
      expect(tr('Lendo {0}', ['app.ts'])).toBe(EN['Lendo {0}'].replace('{0}', 'app.ts'));
      expect(tr('Texto que ninguém traduziu')).toBe('Texto que ninguém traduziu');
    } finally {
      registerDictionary('ur-Latn', UR);
    }
  });

  it('o Habblaud World só conhece os quatro idiomas de origem: o Roman Urdu vai como inglês', () => {
    expect(baseLocale('ur-Latn')).toBe('en');
    expect(baseLocale('fr')).toBe('fr');
    expect(baseLocale('pt-BR')).toBe('pt-BR');
    setLocale('ur-Latn');
    expect(baseLocale()).toBe('en');
  });

  it('Roman Urdu traduz os mesmos textos que o inglês', () => {
    expect(Object.keys(UR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('nenhuma tradução fica vazia nem perde ou inventa lacunas', () => {
    // Junta os problemas e confere uma vez só: ~12 mil textos com um expect cada passavam do tempo em máquina carregada.
    const problems: string[] = [];
    for (const [lang, dict] of Object.entries({ en: EN, es: ES, fr: FR, ur: UR })) {
      for (const [pt, t] of Object.entries(dict)) {
        if (!t.trim()) problems.push(`${lang}: vazia: ${pt}`);
        const original = placeholders(pt);
        const translated = placeholders(t);
        for (const p of translated) if (!original.has(p)) problems.push(`${lang}: inventou ${p}: ${pt} -> ${t}`);
        if (lang !== 'fr') for (const p of original) if (!translated.has(p)) problems.push(`${lang}: perdeu ${p}: ${pt} -> ${t}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
