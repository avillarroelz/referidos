// backend/tests/unit/services/notificationService.test.js

const mockCreate = jest.fn().mockResolvedValue({ id: 1 })
const mockFindOne = jest.fn().mockResolvedValue(null)
const mockGetUsuarios = jest.fn().mockResolvedValue([])
const mockUsuarioFindByPk = jest.fn()

jest.mock('../../../src/db', () => ({
  getModel: jest.fn((name) => {
    if (name === 'Notificacion') return { create: mockCreate }
    if (name === 'Rol') return {
      findOne: jest.fn().mockResolvedValue({ getUsuarios: mockGetUsuarios }),
    }
    if (name === 'Usuario') return { findByPk: mockUsuarioFindByPk }
    return {}
  }),
}))

const {
  crearNotificacion,
  notificarCambioEstado,
  notificarComentario,
  notificarAsignacion,
  notificarNuevoReferidoPublico,
  notificarSLAVencido,
} = require('../../../src/services/notificationService')

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('crearNotificacion', () => {
    it('debe crear una notificación en la BD', async () => {
      const data = {
        destinatarioUserId: 1,
        tipo: 'cambio_estado',
        titulo: 'Test',
        mensaje: 'Mensaje test',
        referidoId: 5,
        metadata: { foo: 'bar' },
      }

      await crearNotificacion(data)
      expect(mockCreate).toHaveBeenCalledWith(data)
    })
  })

  describe('notificarCambioEstado', () => {
    it('debe notificar al creador del referido', async () => {
      const referido = {
        id: 1,
        nombre: 'Juan',
        creadoPorUserId: 2,
        asignadoADCUserId: null,
      }

      await notificarCambioEstado(referido, 'PENDIENTE', 'EN_REVISION', 99)

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          destinatarioUserId: 2,
          tipo: 'cambio_estado',
          titulo: 'Cambio de Estado',
          mensaje: 'Juan: PENDIENTE → EN_REVISION',
          referidoId: 1,
        })
      )
    })

    it('debe notificar al ADC asignado si existe', async () => {
      const referido = {
        id: 1,
        nombre: 'Juan',
        creadoPorUserId: 2,
        asignadoADCUserId: 3,
      }

      await notificarCambioEstado(referido, 'ENVIADO_ADC', 'VALIDADO_ADC', 99)

      expect(mockCreate).toHaveBeenCalledTimes(2)
    })

    it('no debe notificar al actor que realizó el cambio', async () => {
      const referido = {
        id: 1,
        nombre: 'Juan',
        creadoPorUserId: 5,
        asignadoADCUserId: null,
      }

      await notificarCambioEstado(referido, 'PENDIENTE', 'EN_REVISION', 5)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('no debe duplicar notificación si creador y actor son el mismo ADC', async () => {
      const referido = {
        id: 1,
        nombre: 'Juan',
        creadoPorUserId: 2,
        asignadoADCUserId: 2,
      }

      await notificarCambioEstado(referido, 'ENVIADO_ADC', 'VALIDADO_ADC', 99)
      // Solo 1 notificación porque creador y ADC son la misma persona
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('notificarComentario', () => {
    it('notifica al ADC asignado y NO al creador TRABAJADOR', async () => {
      mockUsuarioFindByPk.mockResolvedValue({ id: 2, roles: [{ nombre: 'TRABAJADOR' }] })
      const referido = {
        id: 1,
        nombre: 'Juan',
        creadoPorUserId: 2,
        asignadoADCUserId: 3,
      }

      await notificarComentario(referido, 99, 'Admin')

      expect(mockCreate).toHaveBeenCalledTimes(1)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          destinatarioUserId: 3,
          tipo: 'comentario',
          titulo: 'Nuevo Comentario',
          mensaje: 'Admin comentó en Juan',
          referidoId: 1,
        })
      )
    })

    it('notifica al creador si además tiene rol de gestión (RRHH)', async () => {
      mockUsuarioFindByPk.mockResolvedValue({ id: 2, roles: [{ nombre: 'RRHH' }] })
      const referido = { id: 1, nombre: 'Juan', creadoPorUserId: 2, asignadoADCUserId: null }

      await notificarComentario(referido, 99, 'Admin')

      expect(mockCreate).toHaveBeenCalledTimes(1)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ destinatarioUserId: 2 })
      )
    })

    it('notifica al creador si es además el ADC asignado, sin duplicar', async () => {
      mockUsuarioFindByPk.mockResolvedValue({ id: 2, roles: [{ nombre: 'ADC' }] })
      const referido = { id: 1, nombre: 'Juan', creadoPorUserId: 2, asignadoADCUserId: 2 }

      await notificarComentario(referido, 99, 'Admin')

      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it('no debe notificar al autor del comentario', async () => {
      const referido = {
        id: 1,
        nombre: 'Juan',
        creadoPorUserId: 5,
        asignadoADCUserId: null,
      }

      await notificarComentario(referido, 5, 'Autor')
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('el autor nunca se notifica a sí mismo (ADC asignado que comenta)', async () => {
      mockUsuarioFindByPk.mockResolvedValue({ id: 2, roles: [{ nombre: 'TRABAJADOR' }] })
      const referido = { id: 1, nombre: 'Juan', creadoPorUserId: 2, asignadoADCUserId: 3 }

      await notificarComentario(referido, 3, 'ADC')
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('el autor RRHH creador no se notifica a sí mismo', async () => {
      mockUsuarioFindByPk.mockResolvedValue({ id: 2, roles: [{ nombre: 'RRHH' }] })
      const referido = { id: 1, nombre: 'Juan', creadoPorUserId: 2, asignadoADCUserId: null }

      await notificarComentario(referido, 2, 'RRHH')
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  describe('notificarAsignacion', () => {
    it('debe notificar al ADC asignado', async () => {
      const referido = { id: 1, nombre: 'Juan' }

      await notificarAsignacion(referido, 3)

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          destinatarioUserId: 3,
          tipo: 'asignacion',
          titulo: 'Nuevo Referido Asignado',
          referidoId: 1,
        })
      )
    })
  })

  describe('notificarNuevoReferidoPublico', () => {
    it('debe notificar a todos los RRHH', async () => {
      mockGetUsuarios.mockResolvedValueOnce([{ id: 10 }, { id: 11 }])

      const referido = { id: 1, nombre: 'Referido Público' }
      await notificarNuevoReferidoPublico(referido)

      expect(mockCreate).toHaveBeenCalledTimes(2)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          destinatarioUserId: 10,
          tipo: 'referido_publico',
        })
      )
    })
  })

  describe('notificarSLAVencido', () => {
    it('debe notificar al ADC asignado y a RRHH', async () => {
      mockGetUsuarios.mockResolvedValueOnce([{ id: 20 }])

      const referido = {
        id: 1,
        nombre: 'Juan',
        asignadoADCUserId: 3,
        slaDeadline: new Date(),
      }

      await notificarSLAVencido(referido)

      // ADC (3) + RRHH (20) = 2 notificaciones
      expect(mockCreate).toHaveBeenCalledTimes(2)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tipo: 'sla_vencido',
          titulo: 'SLA Vencido',
        })
      )
    })
  })
})
