// backend/src/utils/jwt.js
const jwt = require('jsonwebtoken')
const { config } = require('../config')

/**
 * Genera un access token (corta duración)
 */
function generateAccessToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    algorithm: config.jwt.algorithm
  })
}

/**
 * Genera un refresh token (larga duración)
 */
function generateRefreshToken(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    algorithm: config.jwt.algorithm
  })
}

/**
 * Verifica un access token
 */
function verifyAccessToken(token) {
  try {
    return { valid: true, decoded: jwt.verify(token, config.jwt.secret, { algorithms: [config.jwt.algorithm] }) }
  } catch (error) {
    return { valid: false, error: error.message }
  }
}

/**
 * Verifica un refresh token
 */
function verifyRefreshToken(token) {
  try {
    return { valid: true, decoded: jwt.verify(token, config.jwt.refreshSecret, { algorithms: [config.jwt.algorithm] }) }
  } catch (error) {
    return { valid: false, error: error.message }
  }
}

/**
 * Genera ambos tokens
 */
function generateTokens(payload) {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload)
  }
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokens
}