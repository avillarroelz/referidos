// backend/src/routes/kpis.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const ctrl = require('../controllers/kpis.controller')

router.use(authRequired, requireRoles('ADMIN','RRHH'))

router.get('/overview', ctrl.rangeValidators, ctrl.overview)
router.get('/series', ctrl.rangeValidators, ctrl.series)
router.get('/leadtime', ctrl.rangeValidators, ctrl.leadtime)
router.get('/funnel', ctrl.rangeValidators, ctrl.funnel)

module.exports = router
