export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export async function apiPost(path: string, formData: FormData) {
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body: formData })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

// For the newer JSON-body endpoints (/api/classes, /api/students/roster,
// /api/students/{id}/consent, /api/attendance/review-correct) -- the
// original apiPost above is FormData-only, which those don't use.
export async function apiPostJson(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export async function apiGet(path: string) {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}