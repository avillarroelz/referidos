// src/utils/mailer.js
const nodemailer = require('nodemailer')
const { getModel } = require('../db')

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com'
const SMTP_PORT = Number(process.env.SMTP_PORT || 465)
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true') === 'true'
const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `"No-Reply" <${SMTP_USER}>` : 'no-reply@local')

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
})

async function sendMail({ to, subject, html, text, cc, bcc, attachments, from, template='-', unidadNegocio='-' }) {
  if (!to || !subject) throw new Error('Faltan to/subject')
  const info = await transporter.sendMail({ from: from || SMTP_FROM, to, subject, html, text, cc, bcc, attachments })
  try {
    const Correo = getModel('Correo')
    await Correo.create({
      correo: Array.isArray(to) ? to.join(',') : String(to),
      destino: Array.isArray(bcc) ? bcc.join(',') : (bcc || '-'),
      proyecto: template,
      unidad_negocio: unidadNegocio || '-',
    })
  } catch {}
  return info
}

module.exports = { transporter, sendMail, sendEmail: sendMail }
