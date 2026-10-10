import { describe, expect, it } from 'vitest';
import { localeForTag } from '../../src/client/i18n';

describe('browser language tags', () => {
  it('match a language by its base, whatever the region', () => {
    expect(localeForTag('de-AT')).toBe('de');
    expect(localeForTag('ja-JP')).toBe('ja');
    expect(localeForTag('ko')).toBe('ko');
  });

  it('tell Chinese apart by script', () => {
    expect(localeForTag('zh')).toBe('zh-Hans');
    expect(localeForTag('zh-CN')).toBe('zh-Hans');
    expect(localeForTag('zh-SG')).toBe('zh-Hans');
    expect(localeForTag('zh-TW')).toBe('zh-Hant');
    expect(localeForTag('zh-HK')).toBe('zh-Hant');
    expect(localeForTag('zh-Hant-CN')).toBe('zh-Hant');
  });

  it('leave languages the app lacks, and malformed tags, to the next choice', () => {
    expect(localeForTag('pt-BR')).toBeNull();
    expect(localeForTag('not a tag')).toBeNull();
  });
});
