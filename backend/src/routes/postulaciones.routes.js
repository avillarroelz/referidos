// backend/src/routes/postulaciones.routes.js
const router = require('express').Router()
const { authRequired } = require('../middleware/auth')
const ctrl = require('../controllers/postulaciones.controller')

// Todas requieren login (cualquier usuario autenticado postula a su propia cuenta)
router.use(authRequired)

// Crear postulación ligada al usuario autenticado
router.post('/', ctrl.crearValidators, ctrl.crear)

// Listar las postulaciones del usuario autenticado
router.get('/mias', ctrl.listarMias)

module.exports = router
