export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function apiPost(path: string, formData: FormData) {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function apiGet(path: string) {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}