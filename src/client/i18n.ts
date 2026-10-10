import { i18n, type Messages } from '@lingui/core';
import { messages as english } from './locales/en.po';

export interface Language {
  locale: string;
  /** The language's own name, so people can find it whatever is showing. */
  name: string;
  /** Machine-translated and not yet reviewed by players. */
  unreviewed?: boolean;
}

export const LANGUAGES: Language[] = [
  { locale: 'en', name: 'English' },
  { locale: 'de', name: 'Deutsch', unreviewed: true },
  { locale: 'es', name: 'Español', unreviewed: true },
  { locale: 'fr', name: 'Français', unreviewed: true },
  { locale: 'it', name: 'Italiano', unreviewed: true },
  { locale: 'nl', name: 'Nederlands', unreviewed: true },
  { locale: 'ru', name: 'Русский', unreviewed: true },
  { locale: 'ja', name: '日本語', unreviewed: true },
  { locale: 'ko', name: '한국어', unreviewed: true },
  { locale: 'zh-Hans', name: '简体中文', unreviewed: true },
  { locale: 'zh-Hant', name: '繁體中文', unreviewed: true },
  ...(import.meta.env.DEV ? [{ locale: 'pseudo', name: 'Pseudo' }] : []),
];

// English ships with the app, so text stays readable if another catalog can't load.
const catalogs: Record<string, () => Promise<{ messages: Messages }>> = {
  de: () => import('./locales/de.po'),
  es: () => import('./locales/es.po'),
  fr: () => import('./locales/fr.po'),
  it: () => import('./locales/it.po'),
  nl: () => import('./locales/nl.po'),
  ru: () => import('./locales/ru.po'),
  ja: () => import('./locales/ja.po'),
  ko: () => import('./locales/ko.po'),
  'zh-Hans': () => import('./locales/zh-Hans.po'),
  'zh-Hant': () => import('./locales/zh-Hant.po'),
  ...(import.meta.env.DEV ? { pseudo: () => import('./locales/pseudo.po') } : {}),
};

const STORAGE_KEY = 'turnip-tycoon:language';

function supported(locale: string | null | undefined): string | null {
  return LANGUAGES.some((language) => language.locale === locale) ? locale! : null;
}

function storedLocale(): string | null {
  try {
    return supported(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** The app's locale for a browser language tag; Chinese is told apart by script, so zh-TW is zh-Hant. */
export function localeForTag(tag: string): string | null {
  try {
    const locale = new Intl.Locale(tag);
    return supported(locale.language === 'zh' ? `zh-${locale.maximize().script}` : locale.language);
  } catch {
    return null;
  }
}

/** The language chosen on this device, otherwise the first one the browser asks for that the app has. */
export function preferredLocale(): string {
  const stored = storedLocale();
  if (stored) return stored;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = localeForTag(tag);
    if (match) return match;
  }
  return 'en';
}

export async function activateLocale(locale: string): Promise<void> {
  let messages = english;
  if (locale !== 'en') {
    try {
      messages = (await catalogs[locale]()).messages;
    } catch {
      locale = 'en';
    }
  }
  i18n.loadAndActivate({ locale, messages });
  document.documentElement.lang = locale === 'pseudo' ? 'en' : locale;
}

export async function chooseLocale(locale: string): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // The choice still applies until the app is closed.
  }
  await activateLocale(locale);
}
