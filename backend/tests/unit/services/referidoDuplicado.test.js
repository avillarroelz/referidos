// backend/tests/unit/services/referidoDuplicado.test.js
// Un mismo postulante no debe pasar por distinto solo por como escribe el RUT
// (puntos, guion, k/K) o el correo (mayusculas, espacios).
const db = require('../../../src/db')
const { buscarReferidoExistente, clavesDePersona } = require('../../../src/services/referidoDuplicado')
const { seedRoles, createTestUser } = require('../../helpers/auth')

describe('buscarReferidoExistente', () => {
  let Referido
  let usuario

  beforeAll(async () => {
    const { getModel } = await db.__initTestDb()
    Referido = getModel('Referido')
    await seedRoles(getModel)
    usuario = await createTestUser(getModel, {
      username: 'dup-helper', correo: 'dup-helper@ecora.cl', roles: ['RRHH'],
    })
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await Referido.destroy({ where: {} })
  })

  const crear = (datos) => Referido.create({ nombre: 'Existente', creadoPorUserId: usuario.id, ...datos })

  it.each([
    ['con puntos', '12.345.678-5'],
    ['sin puntos', '12345678-5'],
    ['sin guion', '123456785'],
    ['con espacios', ' 12.345.678-5 '],
  ])('detecta el mismo RUT guardado sin puntos aunque llegue %s', async (_n, rut) => {
    const existente = await crear({ rut: '12345678-5' })

    const r = await buscarReferidoExistente({ rut })

    expect(r).toMatchObject({ id: existente.id, nombre: 'Existente' })
  })

  it('detecta el RUT guardado con puntos aunque llegue sin ellos', async () => {
    const existente = await crear({ rut: '12.345.678-5' })

    const r = await buscarReferidoExistente({ rut: '12345678-5' })

    expect(r.id).toBe(existente.id)
  })

  it('k y K son el mismo digito verificador', async () => {
    // 1.000.005-K es un RUT con DV valido K.
    const existente = await crear({ rut: '1000005-K' })

    expect((await buscarReferidoExistente({ rut: '1.000.005-k' })).id).toBe(existente.id)
    expect((await buscarReferidoExistente({ rut: '1000005k' })).id).toBe(existente.id)
  })

  it('un RUT con DV invalido no cuenta como RUT (no hay coincidencia)', async () => {
    await crear({ rut: '12345678-9' })

    expect(await buscarReferidoExistente({ rut: '12.345.678-9' })).toBeNull()
  })

  it('el correo se compara sin importar mayusculas ni espacios', async () => {
    const existente = await crear({ email: 'Juan@Gmail.com' })

    expect((await buscarReferidoExistente({ email: 'juan@gmail.com' })).id).toBe(existente.id)
    expect((await buscarReferidoExistente({ email: '  JUAN@GMAIL.COM ' })).id).toBe(existente.id)
  })

  it('sin RUT ni correo, o sin coincidencia, devuelve null', async () => {
    await crear({ email: 'otro@x.cl', rut: '11111111-1' })

    expect(await buscarReferidoExistente({})).toBeNull()
    expect(await buscarReferidoExistente({ rut: null, email: '' })).toBeNull()
    expect(await buscarReferidoExistente({ rut: '22222222-2', email: 'nadie@x.cl' })).toBeNull()
  })

  // Un correo que salio del remitente (p. ej. una consultora que reenvia CVs) es una
  // clave DEBIL: solo identifica si ademas coincide el nombre normalizado.
  describe('correo rellenado desde el remitente (clave debil: correo + nombre)', () => {
    const debil = (nombre, extra = {}) => ({
      email: 'rrhh@consultora.cl', nombre, rellenadoDesdeRemitente: ['email'], ...extra,
    })

    it('mismo correo y mismo nombre (sin importar mayusculas, tildes ni espacios) es la misma persona', async () => {
      const existente = await crear({ nombre: 'María  Pérez', email: 'RRHH@consultora.cl' })

      expect((await buscarReferidoExistente(debil('MARIA PEREZ'))).id).toBe(existente.id)
      expect((await buscarReferidoExistente(debil(' maría pérez '))).id).toBe(existente.id)
    })

    it('mismo correo con distinto nombre (consultora) no colisiona', async () => {
      await crear({ nombre: 'María Pérez', email: 'rrhh@consultora.cl' })

      expect(await buscarReferidoExistente(debil('Juan Soto'))).toBeNull()
    })

    it('sin nombre no hay con que confirmar: no cuenta', async () => {
      await crear({ nombre: 'María Pérez', email: 'rrhh@consultora.cl' })

      expect(await buscarReferidoExistente(debil(''))).toBeNull()
      expect(await buscarReferidoExistente(debil(undefined))).toBeNull()
    })

    it('emailDeRelleno (decidido por el servidor en el import manual) tambien lo vuelve debil', async () => {
      await crear({ nombre: 'María Pérez', email: 'rrhh@consultora.cl' })

      expect(await buscarReferidoExistente({ email: 'rrhh@consultora.cl', nombre: 'Juan Soto', emailDeRelleno: true })).toBeNull()
      expect(await buscarReferidoExistente({ email: 'rrhh@consultora.cl', nombre: 'Maria Perez', emailDeRelleno: true })).not.toBeNull()
    })

    it('un flag enviado por el cliente (emailDesdeRemitente) no se respeta: el correo sigue siendo identidad', async () => {
      await crear({ nombre: 'María Pérez', email: 'maria@gmail.com' })

      expect(await buscarReferidoExistente({ email: 'maria@gmail.com', nombre: 'Otro', emailDesdeRemitente: true })).not.toBeNull()
    })

    it('el RUT propio sigue contando aunque el correo venga del remitente', async () => {
      const existente = await crear({ rut: '12345678-5' })

      const r = await buscarReferidoExistente(debil('Otro', { rut: '12.345.678-5' }))

      expect(r.id).toBe(existente.id)
    })

    it('clavesDePersona: clave emailnombre con el nombre normalizado; sin nombre, sin clave', () => {
      expect(clavesDePersona(debil('María  Pérez'))).toEqual(['emailnombre:rrhh@consultora.cl|MARIA PEREZ'])
      expect(clavesDePersona(debil(''))).toEqual([])
      expect(clavesDePersona(debil('Ana', { rut: '12345678-5' }))).toEqual(['rut:12345678-5', 'emailnombre:rrhh@consultora.cl|ANA'])
      expect(clavesDePersona({ email: 'A@x.cl' })).toEqual(['email:a@x.cl'])
    })
  })

  // Un RUT de DV invalido (typo) igual identifica al mismo postulante si llega con el mismo texto.
  it('RUT con DV invalido: el mismo texto exacto desde Gmail detecta el duplicado', async () => {
    const existente = await crear({ rut: '12.345.678-9' })

    expect((await buscarReferidoExistente({ rut: '12.345.678-9' })).id).toBe(existente.id)
    expect((await buscarReferidoExistente({ rut: ' 12.345.678-9 ' })).id).toBe(existente.id)
  })

  it('clavesDePersona: RUT invalido usa el texto crudo limpio', () => {
    expect(clavesDePersona({ rut: '12.345.678-9' })).toEqual(['rutcrudo:12345678-9'])
    expect(clavesDePersona({ rut: ' 12345678-9 ' })).toEqual(['rutcrudo:12345678-9'])
  })
})
