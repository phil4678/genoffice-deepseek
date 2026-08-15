import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS, defaultAiSettings, resolveAiSettings } from '../src/providers'

describe('defaultAiSettings', () => {
  it('gives every provider its default model and an empty key by default', () => {
    const settings = defaultAiSettings()
    expect(settings.provider).toBe('deepseek')
    for (const meta of AI_PROVIDERS) {
      expect(settings.providers[meta.id].apiKey).toBe('')
      expect(settings.providers[meta.id].model).toBe(meta.defaultModel)
    }
    expect(settings.providers.custom.baseUrl).toBe('')
    expect(settings.providers.anthropic.baseUrl).toBeUndefined()
  })

  it('applies caller-supplied default keys only to the listed providers', () => {
    const settings = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(settings.providers.anthropic.apiKey).toBe('sk-ant-preset')
    expect(settings.providers.gemini.apiKey).toBe('')
  })
})

describe('resolveAiSettings', () => {
  it('returns fresh defaults when nothing is stored', () => {
    const defaults = defaultAiSettings({ anthropic: 'sk-ant-preset' })
    expect(resolveAiSettings({}, defaults)).toEqual(defaults)
  })

  it('migrates the pre-provider single-endpoint shape into the custom provider', () => {
    const defaults = defaultAiSettings()
    const resolved = resolveAiSettings(
      { apiKey: 'legacy-key', model: 'legacy-model', baseUrl: 'https://legacy.example.com/v1' },
      defaults,
    )
    expect(resolved.providers.custom).toEqual({
      apiKey: 'legacy-key',
      model: 'legacy-model',
      baseUrl: 'https://legacy.example.com/v1',
    })
    // untouched providers keep their defaults
    expect(resolved.providers.anthropic).toEqual(defaults.providers.anthropic)
  })

  it('defaults the legacy base URL to the OpenAI endpoint when omitted', () => {
    const resolved = resolveAiSettings({ apiKey: 'legacy-key' }, defaultAiSettings())
    expect(resolved.providers.custom.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('merges stored multi-provider settings over the defaults, provider by provider', () => {
    const defaults = defaultAiSettings({ anthropic: 'preset-key' })
    const resolved = resolveAiSettings(
      {
        provider: 'gemini',
        providers: {
          gemini: { apiKey: 'stored-gemini-key', model: 'gemini-2.5-pro' },
        } as never,
      },
      defaults,
    )
    expect(resolved.provider).toBe('gemini')
    expect(resolved.providers.gemini).toEqual({
      apiKey: 'stored-gemini-key',
      model: 'gemini-2.5-pro',
    })
    // provider not mentioned in stored.providers keeps the computed default
    expect(resolved.providers.anthropic.apiKey).toBe('preset-key')
  })

  it('migrates a stored genspark provider selection to deepseek', () => {
    const resolved = resolveAiSettings(
      {
        provider: 'genspark' as never,
        providers: {
          genspark: { apiKey: 'stored-gsk-key', model: 'claude-opus-4-7' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.provider).toBe('deepseek')
    expect(resolved.providers.deepseek.model).toBe('deepseek-v4-pro')
    expect(resolved.providers.deepseek.apiKey).toBe('')
  })

  it('preserves a stored deepseek config through the genspark migration', () => {
    const resolved = resolveAiSettings(
      {
        provider: 'genspark' as never,
        providers: {
          deepseek: { apiKey: 'sk-stored', model: 'deepseek-v4-flash' },
        } as never,
      },
      defaultAiSettings(),
    )
    expect(resolved.provider).toBe('deepseek')
    expect(resolved.providers.deepseek).toEqual({ apiKey: 'sk-stored', model: 'deepseek-v4-flash' })
  })

  it('remaps retired deepseek model aliases to the v4 default', () => {
    const defaults = defaultAiSettings()
    for (const retired of ['deepseek-chat', 'deepseek-reasoner'] as const) {
      const resolved = resolveAiSettings(
        {
          provider: 'deepseek',
          providers: {
            deepseek: { apiKey: 'sk-stored', model: retired },
          } as never,
        },
        defaults,
      )
      expect(resolved.providers.deepseek.model).toBe('deepseek-v4-pro')
      expect(resolved.providers.deepseek.apiKey).toBe('sk-stored')
    }
  })
})
