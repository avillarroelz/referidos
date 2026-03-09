// backend/src/routes/personas.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const ctrl = require('../controllers/persona.controller')

// /api/personas/*
router.get('/', authRequired, requireRoles('ADMIN','RRHH'), ctrl.list)
router.get('/:id', authRequired, requireRoles('ADMIN','RRHH'), ctrl.getValidators, ctrl.getById)
router.post('/', authRequired, requireRoles('ADMIN','RRHH'), ctrl.createValidators, ctrl.create)
router.put('/:id', authRequired, requireRoles('ADMIN','RRHH'), ctrl.updateValidators, ctrl.update)
router.delete('/:id', authRequired, requireRoles('ADMIN'), ctrl.removeValidators, ctrl.remove)

module.exports = router
