// backend/tests/unit/lib/rut.test.js
// La forma normalizada debe coincidir byte a byte con la de black: sobre ella
// se calcula la huella HMAC.
const { normalizarRut } = require('../../../src/lib/rut')

describe('normalizarRut', () => {
  it.each([
    ['12.345.678-5', '12345678-5'],
    ['12345678-5', '12345678-5'],
    ['123456785', '12345678-5'],
    ['  12.345.678-5 ', '12345678-5'],
    ['12 345 678-5', '12345678-5'],
    ['12.345.678 - 5', '12345678-5'],
    ['12345678–5', '12345678-5'], // guion largo
    ['12345678−5', '12345678-5'], // signo menos
    ['12345678‐5', '12345678-5'], // U+2010
    ['12345678―5', '12345678-5'], // U+2015
    ['12	345 678-5', '12345678-5'],
  ])('normaliza %s', (entrada, esperado) => {
    expect(normalizarRut(entrada)).toBe(esperado)
  })

  it('acepta K minúscula y la devuelve en mayúscula', () => {
    expect(normalizarRut('1.000.005-k')).toBe('1000005-K')
    expect(normalizarRut('1000005K')).toBe('1000005-K')
  })

  it('quita ceros a la izquierda', () => {
    expect(normalizarRut('012345678-5')).toBe('12345678-5')
    expect(normalizarRut('00000012345678-5')).toBe('12345678-5')
  })

  it('acepta cuerpos cortos', () => {
    expect(normalizarRut('1-9')).toBe('1-9')
  })

  it('rechaza un dígito verificador incorrecto', () => {
    expect(normalizarRut('12345678-4')).toBe('')
    expect(normalizarRut('1000005-9')).toBe('')
  })

  it.each([
    [undefined], [null], [12345678], [{}], [[]],
    [''], ['   '], ['-'], ['abc'], ['12345678'], ['K'],
    ['12.345.678-55'], ['123456789012-5'], ['012345678912-5'], ['12345678-'], ['12a345.678-5'], ['12345678--5'],
  ])('devuelve cadena vacía para %p', (entrada) => {
    expect(normalizarRut(entrada)).toBe('')
  })
})
