// backend/src/routes/roles.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const ctrl = require('../controllers/roles.controller')

// /api/roles/*
router.get('/', authRequired, requireRoles('ADMIN','RRHH'), ctrl.list)
router.get('/usuarios', authRequired, requireRoles('ADMIN','RRHH'), ctrl.listUsuarios)
router.post('/', authRequired, requireRoles('ADMIN'), ctrl.createValidators, ctrl.create)
router.delete('/:id', authRequired, requireRoles('ADMIN'), ctrl.removeValidators, ctrl.remove)

// asignación de roles a usuarios
router.post('/asignar/:usuarioId', authRequired, requireRoles('ADMIN'), ctrl.assignValidators, ctrl.assignRole)
router.post('/quitar/:usuarioId', authRequired, requireRoles('ADMIN'), ctrl.unassignValidators, ctrl.unassignRole)

module.exports = router
