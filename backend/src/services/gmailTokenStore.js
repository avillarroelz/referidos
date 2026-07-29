// backend/src/services/gmailTokenStore.js
// Almacén del token OAuth de la casilla de sincronización de Gmail (reclutamiento@).
// En producción vive cifrado en AWS Secrets Manager (GMAIL_TOKEN_SECRET_NAME);
// sin esa variable cae al archivo local gmail-config.json (solo desarrollo).
const fs = require('fs')
const path = require('path')

const SECRET_NAME = process.env.GMAIL_TOKEN_SECRET_NAME
const FILE_PATH = path.join(__dirname, '../../gmail-config.json')
const CACHE_TTL_MS = 5 * 60 * 1000

let cache = { value: null, at: 0 }
let smClient = null

function getClient() {
  if (!smClient) {
    const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager')
    smClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'sa-east-1' })
  }
  return smClient
}

async function readConfig() {
  if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  let config = {}
  if (SECRET_NAME) {
    try {
      const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager')
      const out = await getClient().send(new GetSecretValueCommand({ SecretId: SECRET_NAME }))
      config = JSON.parse(out.SecretString || '{}')
    } catch (e) {
      console.error('[gmail] Error leyendo secreto de Secrets Manager:', e.name || e.message)
      // Ante un error transitorio, mejor la última copia conocida que nada
      return cache.value || {}
    }
  } else {
    try {
      if (fs.existsSync(FILE_PATH)) config = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'))
    } catch (e) {
      console.error('[gmail] Error leyendo config local:', e.message)
    }
  }

  cache = { value: config, at: Date.now() }
  return config
}

async function saveConfig(config) {
  if (SECRET_NAME) {
    const { PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager')
    await getClient().send(new PutSecretValueCommand({
      SecretId: SECRET_NAME,
      SecretString: JSON.stringify(config),
    }))
  } else {
    fs.writeFileSync(FILE_PATH, JSON.stringify(config, null, 2))
  }
  cache = { value: config, at: Date.now() }
}

async function getSyncRefreshToken() {
  const config = await readConfig()
  return config.refresh_token || process.env.GMAIL_SYNC_REFRESH_TOKEN || null
}

module.exports = {
  readConfig,
  saveConfig,
  getSyncRefreshToken,
  storage: SECRET_NAME ? 'secretsmanager' : 'file',
}
