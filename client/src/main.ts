// Ponto de entrada do cliente: primeiro o dicionário do idioma ativo (só ele vai para o navegador), depois o app
// (client/src/app.ts), porque vários módulos chamam tr() ao carregar. Se o dicionário não carregar, fica em português.
// Idioma com reserva (FALLBACK, ex.: Roman Urdu -> inglês): carrega os dois, para um texto sem tradução não cair no PT.
import { FALLBACK, getLocale, registerDictionary, type Locale } from '../../shared/i18n';

const LOADERS: Partial<Record<Locale, () => Promise<Readonly<Record<string, string>>>>> = {
  en: () => import('../../shared/locales/en').then((m) => m.EN),
  es: () => import('../../shared/locales/es').then((m) => m.ES),
  fr: () => import('../../shared/locales/fr').then((m) => m.FR),
  'ur-Latn': () => import('../../shared/locales/ur').then((m) => m.UR),
};

function loadDictionary(l: Locale | undefined): Promise<void> {
  const load = l ? LOADERS[l] : undefined;
  return load ? load().then((d) => registerDictionary(l!, d)).catch(() => undefined) : Promise.resolve();
}

const locale = getLocale();
const dictionary = Promise.all([loadDictionary(locale), loadDictionary(FALLBACK[locale])]);
void dictionary.then(() => import('./app')).then((app) => app.start());

// PWA: o service worker só guarda a página "Habblaud está desligado" (client/public/sw.js); o app continua vindo do
// servidor. Só no build de produção (no `npm run dev` o Vite serve tudo) e em contexto seguro (localhost ou HTTPS).
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
