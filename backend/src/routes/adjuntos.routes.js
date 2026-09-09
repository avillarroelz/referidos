// backend/src/routes/adjuntos.routes.js
const router = require('express').Router({ mergeParams: true })
const { authRequired } = require('../middleware/auth')
const { uploader } = require('../middleware/upload')
const ctrl = require('../controllers/adjuntos.controller')

// Todas requieren login
router.use(authRequired)

// ─────────────────────────────────────────────────────────────────
// ESTAS RUTAS NO LLEVAN requireRoles A PROPOSITO. No es un olvido.
//
// El acceso a un adjunto no depende del ROL sino de la RELACION con el referido
// —creador, postulante externo, ADC asignado o rol privilegiado—, y eso exige
// cargar el recurso, asi que solo puede decidirse dentro del controlador. Las
// cuatro funciones llaman a assertReferidoAccess (src/lib/acceso.js), que es el
// criterio unico del proyecto.
//
// Enumerar roles aca ademas ya rompio el BPM una vez: la lista omitia a
// JefeRRHH y a ADC, y el ADC que debia dictaminar sobre un candidato no podia
// descargar su CV. Una lista blanca de roles se rompe en silencio cada vez que
// aparece o cambia un rol.
//
// Regla del proyecto: control por ROL en la ruta, control por RELACION en el
// controlador.
// ─────────────────────────────────────────────────────────────────

// Listar
router.get('/', ctrl.idValidators, ctrl.list)

// Subir múltiples (campo "files")
router.post('/', ctrl.idValidators, uploader(`referidos`).array('files', 10), ctrl.upload)

// Descargar
router.get('/:docId/download', ctrl.delValidators, ctrl.download)

// Eliminar. Mas restrictivo que el resto: el ADC no borra la evidencia que
// dictamina y el postulante solo mientras nadie haya tomado su postulacion.
// Lo resuelve puedeEliminarDocumentos dentro del controlador.
router.delete('/:docId', ctrl.delValidators, ctrl.remove)

module.exports = router
