// backend/src/lib/estados.js
// Centraliza los estados y las reglas de transición

const ESTADOS = {
  PENDIENTE: 'PENDIENTE',
  EN_REVISION: 'EN_REVISION',
  APROBADO_JEFE: 'APROBADO_JEFE',
  LISTA_ESPERA: 'LISTA_ESPERA',
  ENVIADO_ADC: 'ENVIADO_ADC',
  VALIDADO_ADC: 'VALIDADO_ADC',
  RECHAZADO_ADC: 'RECHAZADO_ADC',
  CONTACTADO: 'CONTACTADO',
  APROBADO: 'APROBADO',
  RECHAZADO: 'RECHAZADO',
  CONTRATADO: 'CONTRATADO',
  NO_CONTRATADO: 'NO_CONTRATADO',
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
  EN_REVISION:    ['APROBADO_JEFE', 'RECHAZADO', 'LISTA_ESPERA'],
  APROBADO_JEFE:  ['ENVIADO_ADC', 'CONTACTADO'],
  LISTA_ESPERA:   ['APROBADO_JEFE'],
  ENVIADO_ADC:    ['VALIDADO_ADC', 'RECHAZADO_ADC'],
  VALIDADO_ADC:   ['CONTACTADO', 'APROBADO'],
  RECHAZADO_ADC:  ['EN_REVISION'],
  CONTACTADO:     ['APROBADO', 'RECHAZADO'],
  APROBADO:       ['CONTRATADO', 'NO_CONTRATADO'],
  RECHAZADO:      [],
  CONTRATADO:     [],
  NO_CONTRATADO:  [],
};

// Modo laxo SOLO para debug: permite cualquier transición entre estados conocidos.
// Requiere opt-in explícito con DEBUG_TRANSITIONS=true; por defecto rigen las reglas ALLOWED.
const DEBUG_TRANSITIONS = process.env.DEBUG_TRANSITIONS === 'true';

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
