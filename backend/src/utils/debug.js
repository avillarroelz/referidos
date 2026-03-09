// backend/src/utils/debug.js
const enabled = String(process.env.DEBUG_REFERIDOS || 'false').toLowerCase() === 'true'

function tag(req) {
  const id = req.id || 'no-reqid'
  return `[req:${id}]`
}

function log(req, ...args) {
  if (!enabled) return
  console.log(tag(req), ...args)
}

function error(req, ...args) {
  console.error(tag(req), ...args)
}

module.exports = { log, error, enabled }
