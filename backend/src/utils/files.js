// src/utils/files.js
const fs = require('fs')
const path = require('path')

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')

function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d }
function safeName(n){ return n.replace(/[^\w.\-]+/g,'_') }

module.exports = { UPLOAD_DIR, ensureDir, safeName }
