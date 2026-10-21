export type Message = { message: string; topic: string }

export async function getMessage(signal?: AbortSignal): Promise<Message> {
  const response = await fetch('/api/message', { signal })
  if (!response.ok) throw new Error(`API request failed (${response.status})`)
  const data: unknown = await response.json()
  if (typeof data !== 'object' || data === null || !('message' in data) || typeof data.message !== 'string' || !('topic' in data) || typeof data.topic !== 'string') {
    throw new Error('Unexpected API response')
  }
  return { message: data.message, topic: data.topic }
}
