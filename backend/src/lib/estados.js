// backend/src/lib/estados.js
// Centraliza los estados y las reglas de transición

const ESTADOS = {
  PENDIENTE: 'PENDIENTE',
  EN_REVISION: 'EN_REVISION',
  ENVIADO_ADC: 'ENVIADO_ADC',
  VALIDADO_ADC: 'VALIDADO_ADC',
  RECHAZADO_ADC: 'RECHAZADO_ADC',
  CONTACTADO: 'CONTACTADO',
  APROBADO: 'APROBADO',
  RECHAZADO: 'RECHAZADO',
};

// Dictámenes posibles del ADC
const DICTAMEN_ADC = {
  CUMPLE: 'CUMPLE',
  CUMPLE_PARCIAL: 'CUMPLE_PARCIAL',
  NO_CUMPLE: 'NO_CUMPLE',
};

// Mapa de transiciones permitidas
const ALLOWED = {
  PENDIENTE:      ['EN_REVISION', 'RECHAZADO'],
  EN_REVISION:    ['ENVIADO_ADC', 'CONTACTADO', 'RECHAZADO'],
  ENVIADO_ADC:    ['VALIDADO_ADC', 'RECHAZADO_ADC'],
  VALIDADO_ADC:   ['CONTACTADO', 'APROBADO'],
  RECHAZADO_ADC:  ['EN_REVISION'],
  CONTACTADO:     ['APROBADO', 'RECHAZADO'],
  APROBADO:       [],
  RECHAZADO:      [],
};

// Si quieres debug laxo: permite todas las transiciones conocidas.
// Pon DEBUG_TRANSITIONS=false en prod para aplicar reglas ALLOWED.
const DEBUG_TRANSITIONS = process.env.DEBUG_TRANSITIONS !== 'false';

function puedePasar(desde, hacia) {
  if (DEBUG_TRANSITIONS) {
    const list = Object.values(ESTADOS);
    const ok = list.includes(desde) && list.includes(hacia);
    if (!ok) console.warn('[Estados] transición con estado(s) desconocidos:', { desde, hacia });
    return ok; // permite mientras existan en ESTADOS
  }
  const allowed = ALLOWED[desde] || [];
  return allowed.includes(hacia);
}

module.exports = { ESTADOS, DICTAMEN_ADC, puedePasar };
