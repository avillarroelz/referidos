// backend/src/services/listaBloqueo.js
// Verifica un RUT contra la lista de no recontratación de black. Si black no
// responde, usa el respaldo local de huellas HMAC. Nunca lanza: una falla de la
// integración no debe impedir el ingreso. Privacidad: ni el RUT ni la huella ni
// la clave se escriben en logs.
const { createHmac } = require('node:crypto')
const { config } = require('../config')
const { sequelize, getModel } = require('../db')
const { normalizarRut } = require('../lib/rut')
const client = require('./listaBloqueoClient')

const TEXTO_RECHAZO = 'No se puede ingresar a esta persona: está en la lista de no recontratación. Contacta a Recursos Humanos.'

const SIN_VERIFICAR = Object.freeze({ bloqueado: false, fuente: 'sin_verificar' })

const huellaKey = () => (config.listaBloqueo || {}).huellaKey || ''
const tipoDeFalla = (err) => err?.tipo || 'inesperado'

// Con 401/403 la clave de API es inválida o fue revocada: aviso aparte y fijo
// para poder alertar. Nunca lleva el RUT ni la clave.
function avisarFalla(err, consecuencia) {
  const tipo = tipoDeFalla(err)
  if (tipo === 'http_401' || tipo === 'http_403') {
    console.error(`[listaBloqueo] la clave de API de black fue rechazada (${tipo}); revisar BLACK_API_KEY`)
  } else {
    console.warn(`[listaBloqueo] black no respondió (${tipo}); ${consecuencia}`)
  }
}

// `estado` lo comparte un lote: tras la primera falla de black no se vuelve a
// llamar (cada intento espera hasta 5 s) y el resto usa solo el respaldo.
async function verificar(rutCrudo, estado) {
  const rut = normalizarRut(rutCrudo)
  if (!rut || !client.estaConfigurado()) return { ...SIN_VERIFICAR }

  if (!estado.blackFallo) {
    try {
      const { bloqueado } = await client.consultarRut(rut)
      return { bloqueado, fuente: 'black' }
    } catch (err) {
      estado.blackFallo = true
      avisarFalla(err, 'se usa el respaldo local')
    }
  }

  const key = huellaKey()
  if (!key) return { ...SIN_VERIFICAR }
  try {
    const huella = createHmac('sha256', key).update(rut).digest('hex')
    const fila = await getModel('ListaBloqueoHuella').findByPk(huella)
    return { bloqueado: Boolean(fila), fuente: 'respaldo' }
  } catch {
    console.warn('[listaBloqueo] no se pudo leer el respaldo local')
    return { ...SIN_VERIFICAR }
  }
}

// Devuelve { bloqueado, fuente: 'black' | 'respaldo' | 'sin_verificar' }.
const verificarRut = (rutCrudo) => verificar(rutCrudo, {})

// Para lotes (importaciones de Gmail): un verificador por lote con cortacircuito.
function crearVerificador() {
  const estado = {}
  return (rutCrudo) => verificar(rutCrudo, estado)
}

// Reemplaza la tabla local por la lista de black. Devuelve la cantidad cargada
// o null si no actualizó (sin configuración, o black/BD fallaron: queda la anterior).
async function actualizarHuellas() {
  if (!client.estaConfigurado() || !huellaKey()) return null

  let huellas
  try {
    huellas = [...new Set(await client.listarHuellas())]
  } catch (err) {
    avisarFalla(err, 'no se actualizó el respaldo; queda la lista anterior')
    return null
  }

  try {
    const Huella = getModel('ListaBloqueoHuella')
    await sequelize.transaction(async (transaction) => {
      await Huella.destroy({ where: {}, transaction })
      if (huellas.length > 0) {
        await Huella.bulkCreate(huellas.map(huella => ({ huella })), { transaction })
      }
    })
    return huellas.length
  } catch {
    console.warn('[listaBloqueo] no se pudo guardar el respaldo; queda la lista anterior')
    return null
  }
}

module.exports = { verificarRut, crearVerificador, actualizarHuellas, TEXTO_RECHAZO }
