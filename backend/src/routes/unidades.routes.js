// backend/src/routes/unidades.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const ctrl = require('../controllers/unidadNegocio.controller')

// /api/unidades/*
router.get('/', authRequired, requireRoles('ADMIN','RRHH'), ctrl.listValidators, ctrl.list)
router.post('/', authRequired, requireRoles('ADMIN'), ctrl.createValidators, ctrl.create)
router.put('/:id', authRequired, requireRoles('ADMIN'), ctrl.updateValidators, ctrl.update)
router.delete('/:id', authRequired, requireRoles('ADMIN'), ctrl.removeValidators, ctrl.remove)

// asignar/quitar unidad a usuario
router.post('/asignar/:usuarioId', authRequired, requireRoles('ADMIN','RRHH'), ctrl.assignValidators, ctrl.assignUnidad)
router.post('/quitar/:usuarioId', authRequired, requireRoles('ADMIN','RRHH'), ctrl.unassignValidators, ctrl.unassignUnidad)

module.exports = router
