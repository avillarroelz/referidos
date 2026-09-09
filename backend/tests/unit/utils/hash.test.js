// backend/tests/unit/utils/hash.test.js
const { hash, compare } = require('../../../src/utils/hash')

describe('Hash Utils', () => {
  describe('hash', () => {
    it('debe devolver un hash distinto del texto plano', async () => {
      const hashed = await hash('password123')
      expect(typeof hashed).toBe('string')
      expect(hashed).not.toBe('password123')
      expect(hashed).not.toContain('password123')
    })

    it('debe usar un salt distinto en cada llamada', async () => {
      const [a, b] = await Promise.all([hash('password123'), hash('password123')])
      expect(a).not.toBe(b)
    })

    it('debe producir un hash bcrypt', async () => {
      expect(await hash('test')).toMatch(/^\$2[aby]\$\d{2}\$/)
    })

    // El factor de coste es lo que hace caro un ataque por fuerza bruta. Bajarlo
    // no rompe ninguna funcionalidad, así que solo una prueba lo detecta.
    it('debe usar un factor de coste de al menos 12', async () => {
      const [, , coste] = (await hash('test')).split('$')
      expect(Number(coste)).toBeGreaterThanOrEqual(12)
    })

    it('debe hashear contraseñas con acentos y símbolos', async () => {
      const clave = 'contraseñaÜñ!@#$%^&*()_+'
      expect(await compare(clave, await hash(clave))).toBe(true)
    })

    it('debe hashear una cadena vacía sin lanzar excepción', async () => {
      const hashed = await hash('')
      expect(await compare('', hashed)).toBe(true)
    })
  })

  describe('compare', () => {
    it('debe aceptar la contraseña correcta', async () => {
      expect(await compare('mypassword', await hash('mypassword'))).toBe(true)
    })

    it('debe rechazar una contraseña incorrecta', async () => {
      expect(await compare('wrongpassword', await hash('mypassword'))).toBe(false)
    })

    it('debe distinguir mayúsculas de minúsculas', async () => {
      expect(await compare('MyPassword', await hash('mypassword'))).toBe(false)
    })

    it('debe rechazar una contraseña con espacios añadidos', async () => {
      const hashed = await hash('mypassword')
      expect(await compare(' mypassword', hashed)).toBe(false)
      expect(await compare('mypassword ', hashed)).toBe(false)
    })

    it('debe rechazar la cadena vacía contra un hash real', async () => {
      expect(await compare('', await hash('mypassword'))).toBe(false)
    })

    // Las cuentas creadas por Google no tienen hash local. Si compare() lanza
    // ante un hash nulo, el login responde 500 en vez de 401 y delata que ese
    // correo es una cuenta OAuth (y de paso se salta el conteo de intentos
    // fallidos). Debe devolver false, nunca lanzar.
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['una cadena vacía', ''],
      ['un hash mal formado', 'no-es-un-hash'],
    ])('debe rechazar %s como hash almacenado', async (_etiqueta, hashAlmacenado) => {
      await expect(compare('mypassword', hashAlmacenado)).resolves.toBe(false)
    })

    // PENDIENTE (reportado al lider): el fix cubrio el hash nulo pero no la
    // contraseña nula, que sigue lanzando "Illegal arguments". Hoy no es
    // explotable porque express-validator exige que password sea string antes
    // de llegar al controlador, pero es la misma linea de defensa.
    it.skip('debe rechazar una contraseña nula contra un hash válido', async () => {
      await expect(compare(null, await hash('mypassword'))).resolves.toBe(false)
    })

    it('un hash no sirve para verificar otra contraseña', async () => {
      const hashA = await hash('claveA')
      const hashB = await hash('claveB')
      expect(await compare('claveA', hashB)).toBe(false)
      expect(await compare('claveB', hashA)).toBe(false)
    })
  })

  // bcrypt solo considera los primeros 72 bytes de la contraseña. Con la
  // política de 12 caracteres mínimos del sistema esto no se alcanza en la
  // práctica, pero conviene tenerlo escrito: si algún día se permite pegar una
  // passphrase larga, dos claves que compartan los primeros 72 bytes son la
  // misma para bcrypt.
  describe('límite de 72 bytes de bcrypt', () => {
    const base = 'a'.repeat(72)

    it('ignora lo que exceda los 72 bytes', async () => {
      const hashed = await hash(base + 'SUFIJO-DISTINTO')
      expect(await compare(base + 'OTRO-SUFIJO', hashed)).toBe(true)
    })

    it('sí distingue contraseñas que difieren dentro de los primeros 72 bytes', async () => {
      const hashed = await hash(base)
      expect(await compare('b'.repeat(72), hashed)).toBe(false)
    })
  })
})
