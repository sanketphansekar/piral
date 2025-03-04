import type { PiralPlugin } from 'piral-core';
import { createActions } from './actions';
import { Localizer } from './localize';
import { DefaultPicker } from './default';
import { PiletLocaleApi, LocalizationMessages, Localizable, PiralSelectLanguageEvent } from './types';

export interface TranslationFallback {
  (key: string, language: string): string;
}

export interface RetrieveCurrentLanguage {
  /**
   * A function to identify the current language.
   */
  (languages: Array<string>, defaultLanguage: string, fallbackLanguage?: string): string;
}

export interface LocaleConfig {
  /**
   * Sets the default (global) localization messages.
   * @default {}
   */
  messages?: LocalizationMessages;
  /**
   * Sets the default language to use.
   */
  language?: string | RetrieveCurrentLanguage;
  /**
   * Sets the optional fallback to use.
   */
  fallback?: TranslationFallback;
}

/**
 * Sets up a new localizer by using the given config.
 * @param config The configuration for the new localizer.
 */
export function setupLocalizer(config: LocaleConfig = {}): Localizable {
  const msgs = config.messages || {};
  const languages = Object.keys(msgs);
  const defaultLang = languages[0] || 'en';
  const computeLang = config.language;
  const usedLang = typeof computeLang === 'function' ? computeLang(languages, defaultLang, 'en') : computeLang;
  const language = usedLang || defaultLang;
  return new Localizer(msgs, language, languages.length ? languages : [language], config.fallback);
}

/**
 * Creates new Pilet API extensions for localization.
 * @param localizer The specific localizer to be used, if any.
 */
export function createLocaleApi(localizer: Localizable = setupLocalizer()): PiralPlugin<PiletLocaleApi> {
  return (context) => {
    context.defineActions(createActions(localizer));

    context.dispatch((state) => ({
      ...state,
      components: {
        LanguagesPicker: DefaultPicker,
        ...state.components,
      },
      language: {
        loading: false,
        available: localizer.languages,
        selected: localizer.language,
      },
    }));

    return (api) => {
      let localTranslations: LocalizationMessages = {};

      return {
        getCurrentLanguage(cb?: (l: string) => void): any {
          const selected = context.readState((s) => s.language.selected);

          if (cb) {
            cb(selected);
            const handler = (ev: PiralSelectLanguageEvent) => {
              cb(ev.currentLanguage);
            };
            api.on('select-language', handler);
            return () => api.off('select-language', handler);
          }

          return selected;
        },
        setTranslations(messages) {
          localTranslations = messages;
        },
        getTranslations() {
          return localTranslations;
        },
        translate(tag, variables) {
          return localizer.localizeLocal(localTranslations, tag, variables);
        },
      };
    };
  };
}
