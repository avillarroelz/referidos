// backend/src/services/emailParserAI.js
const Anthropic = require('@anthropic-ai/sdk').default
const { config } = require('../config')

const SYSTEM_PROMPT = `Eres un extractor de datos de documentos de postulantes laborales en Chile.
Tu tarea es analizar el contenido de un CV, curriculum vitae o documento adjunto de un postulante y extraer sus datos personales y profesionales.

REGLAS:
- Extrae SOLO los datos que encuentres explicitamente en el documento.
- Si un dato NO esta presente, devuelve null para ese campo.
- El RUT chileno tiene formato XX.XXX.XXX-X o XXXXXXXX-X (a veces aparece como "Rut", "R.U.T.", "CI" o "Cedula").
- Los telefonos chilenos empiezan con +56 9 o 9 seguido de 8 digitos. Tambien puede aparecer como celular o movil.
- "nombre" es el nombre completo del postulante/candidato.
- "email" es el correo electronico del postulante.
- "cargoPostulado" es el cargo, puesto o profesion principal que se identifique del documento. Si no hay un cargo explicito, usa el titulo profesional o el ultimo cargo laboral.
- "observaciones" es un resumen MUY breve (1 linea) de la experiencia o perfil del candidato.
- "nombreReferidor" es la persona que envio/refirio al candidato (usualmente esta en el correo, NO en el CV). Si no lo encuentras, devuelve null.
- NO inventes datos. Si no estas seguro, devuelve null.

Responde UNICAMENTE con un JSON valido (sin markdown, sin backticks), con esta estructura exacta:
{
  "nombre": "string o null",
  "email": "string o null",
  "telefono": "string o null",
  "rut": "string o null",
  "cargoPostulado": "string o null",
  "observaciones": "string o null",
  "nombreReferidor": "string o null"
}`

class EmailParserAI {
  constructor() {
    this.client = null
    this.available = false
    this._init()
  }

  _init() {
    const apiKey = config.anthropic?.apiKey
    if (apiKey && apiKey.length > 0) {
      try {
        this.client = new Anthropic({ apiKey })
        this.available = true
        console.log('[EmailParserAI] Servicio IA inicializado correctamente')
      } catch (err) {
        console.warn('[EmailParserAI] No se pudo inicializar:', err.message)
        this.available = false
      }
    } else {
      console.log('[EmailParserAI] ANTHROPIC_API_KEY no configurada, usando fallback regex')
      this.available = false
    }
  }

  isAvailable() {
    return this.available
  }

  /**
   * Parsear contenido usando Claude API
   * @param {string} content - Texto principal (documento o correo)
   * @param {string} subject - Asunto del correo (contexto)
   * @param {string} from - Remitente del correo (contexto)
   * @param {boolean} hasAttachment - Si el contenido viene de un adjunto
   * @returns {Promise<Object>} Datos extraidos
   */
  async parse(content, subject = '', from = '', hasAttachment = false) {
    if (!this.available) {
      throw new Error('EmailParserAI no disponible')
    }

    const source = hasAttachment ? 'DOCUMENTO ADJUNTO (CV/Curriculum)' : 'CORREO ELECTRONICO'
    const userMessage = `Fuente: ${source}
Asunto del correo: ${subject}
Remitente: ${from}

Contenido a analizar:
${content.substring(0, 5000)}`

    // Retry con backoff para manejar rate limits (429/529)
    const MAX_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }]
        })

        const text = response.content[0]?.text || '{}'
        const cleanJson = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim()
        const parsed = JSON.parse(cleanJson)

        return {
          nombre: parsed.nombre || null,
          email: parsed.email || null,
          telefono: parsed.telefono || null,
          rut: parsed.rut || null,
          cargoPostulado: parsed.cargoPostulado || null,
          observaciones: parsed.observaciones || null,
          nombreReferidor: parsed.nombreReferidor || null
        }
      } catch (err) {
        const status = err?.status || err?.error?.status || 0
        const isRetryable = status === 429 || status === 529 || err.message?.includes('overloaded')

        if (isRetryable && attempt < MAX_RETRIES) {
          const waitMs = attempt * 2000 // 2s, 4s
          console.warn(`[EmailParserAI] ${status} en intento ${attempt}, reintentando en ${waitMs}ms...`)
          await new Promise(r => setTimeout(r, waitMs))
          continue
        }

        console.error(`[EmailParserAI] Error parseando (intento ${attempt}/${MAX_RETRIES}):`, err.message)
        throw err
      }
    }
  }
}

module.exports = new EmailParserAI()
