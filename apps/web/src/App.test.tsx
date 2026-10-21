// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from './App'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('renders the real API response contract', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Hello from Go + Fiber!', topic: 'A talk on Watermill' })))
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  expect(await screen.findByText('Hello from Go + Fiber!')).toBeInTheDocument()
  expect(screen.getByText('CONNECTED')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/message', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('shows a recoverable failure and retries', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Recovered', topic: 'Watermill' }))))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Try again/ }))
  expect(await screen.findByText('Recovered')).toBeInTheDocument()
})

it('shows the loading state while the request is pending', () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})))
  render(<App />)
  expect(screen.getByText('Reaching the API…')).toBeInTheDocument()
  expect(screen.getByRole('button')).toBeDisabled()
})
