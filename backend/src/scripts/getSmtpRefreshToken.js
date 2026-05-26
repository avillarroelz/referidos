/* eslint-disable no-console */
// Script CLI para obtener el refresh_token OAuth2 de la cuenta SMTP (ej. no-reply@ecora.cl)
//
// USO:
//   1. En Google Cloud Console (Credenciales del cliente OAuth ya existente):
//      Agregar como "URI de redireccionamiento autorizado":
//         http://localhost:3333/oauth/callback
//   2. Ejecutar:  node src/scripts/getSmtpRefreshToken.js
//   3. Abrir la URL que imprime el script en un navegador con sesión de la cuenta SMTP.
//   4. Autorizar.
//   5. El script imprime el refresh_token → copiarlo en .env como SMTP_OAUTH_REFRESH_TOKEN.

require('dotenv').config()
const http = require('http')
const { URL } = require('url')
const { google } = require('googleapis')

const PORT = 3333
const REDIRECT = `http://localhost:${PORT}/oauth/callback`
const SCOPES = ['https://mail.google.com/']

const CLIENT_ID = process.env.SMTP_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID
const CLIENT_SECRET = process.env.SMTP_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Falta GMAIL_CLIENT_ID o GMAIL_CLIENT_SECRET en .env')
  process.exit(1)
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT)

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',         // fuerza a Google a entregar refresh_token
  scope: SCOPES,
})

console.log('\n────────────────────────────────────────────────────────────')
console.log(' 1. Asegúrate de haber agregado este URI en Google Cloud:')
console.log(`    ${REDIRECT}`)
console.log('\n 2. Abre esta URL en un navegador con sesión de la cuenta SMTP')
console.log('    (ej. no-reply@ecora.cl) y autoriza el acceso:')
console.log(`\n    ${authUrl}\n`)
console.log('────────────────────────────────────────────────────────────\n')

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname !== '/oauth/callback') {
    res.writeHead(404).end('Not found')
    return
  }
  const code = url.searchParams.get('code')
  const err = url.searchParams.get('error')
  if (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Error: ${err}`)
    console.error('❌ Autorización rechazada:', err)
    server.close()
    process.exit(1)
  }
  if (!code) {
    res.writeHead(400).end('Falta el parámetro code')
    return
  }
  try {
    const { tokens } = await oAuth2Client.getToken(code)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`
      <html><body style="font-family:sans-serif;padding:40px;">
        <h2>✅ Autorización completada</h2>
        <p>Revisa la consola del script para copiar el <code>refresh_token</code>.</p>
        <p>Ya puedes cerrar esta pestaña.</p>
      </body></html>
    `)

    console.log('\n────────────────────────────────────────────────────────────')
    console.log(' ✅ Tokens recibidos. Copia el refresh_token a tu .env:')
    console.log('────────────────────────────────────────────────────────────')
    console.log(`SMTP_OAUTH_USER=${tokens.id_token ? '<la cuenta que autorizó>' : '<la cuenta que autorizó>'}`)
    console.log(`SMTP_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log('────────────────────────────────────────────────────────────\n')

    if (!tokens.refresh_token) {
      console.warn('⚠️  Google no devolvió refresh_token.')
      console.warn('   Suele pasar cuando ya autorizaste antes. Solución:')
      console.warn('   https://myaccount.google.com/permissions → Quitar acceso → reintentar')
    }

    server.close()
    process.exit(0)
  } catch (e) {
    console.error('❌ Error intercambiando code:', e.message)
    res.writeHead(500).end('Error intercambiando code: ' + e.message)
    server.close()
    process.exit(1)
  }
})

server.listen(PORT, () => {
  console.log(`⏳ Esperando autorización en ${REDIRECT} ...`)
})
