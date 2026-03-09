// backend/tests/unit/services/slaService.test.js

const mockFindAll = jest.fn().mockResolvedValue([])
const mockNotifFindOne = jest.fn().mockResolvedValue(null)
const mockNotifCreate = jest.fn().mockResolvedValue({ id: 1 })
const mockRolFindOne = jest.fn().mockResolvedValue({
  getUsuarios: jest.fn().mockResolvedValue([]),
})

jest.mock('../../../src/db', () => ({
  getModel: jest.fn((name) => {
    if (name === 'Referido') return { findAll: mockFindAll }
    if (name === 'Notificacion') return {
      findOne: mockNotifFindOne,
      create: mockNotifCreate,
    }
    if (name === 'Rol') return { findOne: mockRolFindOne }
    return {}
  }),
}))

// Mock notificationService
jest.mock('../../../src/services/notificationService', () => ({
  notificarSLAVencido: jest.fn().mockResolvedValue([]),
}))

const { verificarSLAsVencidos } = require('../../../src/services/slaService')
const { notificarSLAVencido } = require('../../../src/services/notificationService')

describe('SLA Service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('debe buscar referidos en ENVIADO_ADC con SLA vencido', async () => {
    mockFindAll.mockResolvedValueOnce([])
    await verificarSLAsVencidos()
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          estado: 'ENVIADO_ADC',
        }),
      })
    )
  })

  it('debe notificar SLA vencido si no fue notificado previamente', async () => {
    const referidoVencido = {
      id: 1,
      nombre: 'Juan',
      asignadoADCUserId: 3,
      slaDeadline: new Date(Date.now() - 86400000), // ayer
    }

    mockFindAll.mockResolvedValueOnce([referidoVencido])
    mockNotifFindOne.mockResolvedValueOnce(null) // no notificado previamente

    await verificarSLAsVencidos()

    expect(notificarSLAVencido).toHaveBeenCalledWith(referidoVencido)
  })

  it('no debe re-notificar si ya se notificó en las últimas 24h', async () => {
    const referidoVencido = {
      id: 1,
      nombre: 'Juan',
      asignadoADCUserId: 3,
      slaDeadline: new Date(Date.now() - 86400000),
    }

    mockFindAll.mockResolvedValueOnce([referidoVencido])
    mockNotifFindOne.mockResolvedValueOnce({ id: 99 }) // ya notificado

    await verificarSLAsVencidos()

    expect(notificarSLAVencido).not.toHaveBeenCalled()
  })

  it('no debe hacer nada si no hay referidos con SLA vencido', async () => {
    mockFindAll.mockResolvedValueOnce([])
    await verificarSLAsVencidos()
    expect(notificarSLAVencido).not.toHaveBeenCalled()
  })

  it('debe manejar errores sin lanzar excepciones', async () => {
    mockFindAll.mockRejectedValueOnce(new Error('DB connection error'))
    // No debe lanzar error
    await expect(verificarSLAsVencidos()).resolves.toBeUndefined()
  })
})
