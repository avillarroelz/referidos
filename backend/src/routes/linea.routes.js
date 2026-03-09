// backend/src/routes/linea.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const ctrl = require('../controllers/lineaNegocio.controller')

// /api/lineas/*
router.get('/', authRequired, requireRoles('ADMIN','RRHH'), ctrl.list)
router.post('/', authRequired, requireRoles('ADMIN'), ctrl.upsertValidators, ctrl.create)
router.put('/:id', authRequired, requireRoles('ADMIN'), ctrl.updateValidators, ctrl.update)
router.delete('/:id', authRequired, requireRoles('ADMIN'), ctrl.removeValidators, ctrl.remove)

module.exports = router
