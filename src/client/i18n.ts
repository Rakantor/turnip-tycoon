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
  ...(import.meta.env.DEV ? [{ locale: 'pseudo', name: 'Pseudo' }] : []),
];

// English ships with the app, so text stays readable if another catalog can't load.
const catalogs: Record<string, () => Promise<{ messages: Messages }>> = {
  de: () => import('./locales/de.po'),
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

/** The language chosen on this device, otherwise the first one the browser asks for that the app has. */
export function preferredLocale(): string {
  const stored = storedLocale();
  if (stored) return stored;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = supported(tag.split('-')[0].toLowerCase());
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
