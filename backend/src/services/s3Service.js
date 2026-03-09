// backend/src/services/s3Service.js
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { Upload } = require('@aws-sdk/lib-storage')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

class S3Service {
  constructor() {
    this.s3Client = null
    this.bucketName = process.env.AWS_BUCKET
  }

  /**
   * Inicializar cliente S3
   */
  initialize() {
    if (this.s3Client) return this.s3Client

    this.s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    })

    return this.s3Client
  }

  /**
   * Subir archivo a S3
   * @param {Buffer|Stream} fileContent - Contenido del archivo
   * @param {string} key - Ruta/nombre del archivo en S3 (ej: "referidos/123/cv.pdf")
   * @param {string} contentType - Tipo MIME del archivo
   * @param {object} metadata - Metadata adicional
   */
  async uploadFile(fileContent, key, contentType, metadata = {}) {
    if (!this.s3Client) this.initialize()

    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucketName,
          Key: key,
          Body: fileContent,
          ContentType: contentType,
          Metadata: metadata
        }
      })

      const result = await upload.done()

      return {
        success: true,
        key: key,
        bucket: this.bucketName,
        location: result.Location,
        etag: result.ETag
      }
    } catch (error) {
      console.error('Error subiendo archivo a S3:', error)
      throw new Error(`Error al subir archivo: ${error.message}`)
    }
  }

  /**
   * Obtener URL firmada para descargar archivo (válida por tiempo limitado)
   * @param {string} key - Ruta del archivo en S3
   * @param {number} expiresIn - Segundos de validez (default: 1 hora)
   */
  async getSignedDownloadUrl(key, expiresIn = 3600) {
    if (!this.s3Client) this.initialize()

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key
      })

      const url = await getSignedUrl(this.s3Client, command, { expiresIn })
      return url
    } catch (error) {
      console.error('Error generando URL firmada:', error)
      throw new Error(`Error al generar URL de descarga: ${error.message}`)
    }
  }

  /**
   * Eliminar archivo de S3
   * @param {string} key - Ruta del archivo en S3
   */
  async deleteFile(key) {
    if (!this.s3Client) this.initialize()

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      })

      await this.s3Client.send(command)

      return {
        success: true,
        message: 'Archivo eliminado correctamente'
      }
    } catch (error) {
      console.error('Error eliminando archivo de S3:', error)
      throw new Error(`Error al eliminar archivo: ${error.message}`)
    }
  }

  /**
   * Generar key único para un archivo de referido
   * @param {string} rut - RUT del referido (sin puntos ni guión)
   * @param {number} referidoId - ID del referido
   * @param {string} fileName - Nombre original del archivo
   * @param {string} tipo - Tipo de documento (cv, carta, certificado, etc.)
   */
  generateReferidoFileKey(rut, referidoId, fileName, tipo = 'documento') {
    const timestamp = Date.now()
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    // Limpiar el RUT (quitar puntos y guiones)
    const sanitizedRut = rut ? rut.replace(/[.-]/g, '') : 'sin-rut'
    return `referidos/${sanitizedRut}/${referidoId}/${tipo}/${timestamp}_${sanitizedFileName}`
  }

  /**
   * Verificar si las credenciales están configuradas
   */
  isConfigured() {
    return !!(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION &&
      process.env.AWS_BUCKET
    )
  }
}

module.exports = new S3Service()
