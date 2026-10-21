import { afterEach, expect, it, vi } from 'vitest'
import { getMessage } from './api'

afterEach(() => vi.unstubAllGlobals())

it('rejects an unsuccessful HTTP response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })))
  await expect(getMessage()).rejects.toThrow('503')
})

it('rejects a response that does not match the contract', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 42 }))))
  await expect(getMessage()).rejects.toThrow('Unexpected API response')
})
