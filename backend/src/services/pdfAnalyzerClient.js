// backend/src/services/pdfAnalyzerClient.js
// Cliente del analizador de PDF en Rust (services/pdf-analyzer), un sidecar HTTP
// sin autenticación que solo debe ser alcanzable desde el backend.
// Sin dependencias: usa fetch nativo de Node.

// 5 s sobre el timeout del sidecar (30 s) + su espera de cupo (10 s), para
// recibir su 503/504 en vez de abortar antes.
const CLIENT_TIMEOUT_MS = 45_000

// Se lee en cada llamada y no al cargar el módulo: los tests levantan el
// sidecar en otro puerto.
const baseUrl = () => process.env.PDF_ANALYZER_URL || 'http://127.0.0.1:4002'

class PdfAnalyzerError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'PdfAnalyzerError'
    this.status = status
  }
}

async function analyzePdf(buffer, { q, signal } = {}) {
  const url = new URL('/analyze', baseUrl())
  if (q) url.searchParams.set('q', q)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: buffer,
    signal: signal ?? AbortSignal.timeout(CLIENT_TIMEOUT_MS),
  })
  const body = await res.json()
  if (!res.ok) throw new PdfAnalyzerError(res.status, body.error ?? 'Error del analizador de PDF')
  return body
}

async function isPdfAnalyzerUp() {
  try {
    const res = await fetch(new URL('/health', baseUrl()), { signal: AbortSignal.timeout(2_000) })
    return res.ok
  } catch {
    return false
  }
}

module.exports = { analyzePdf, isPdfAnalyzerUp, PdfAnalyzerError }
