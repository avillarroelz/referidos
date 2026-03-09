// backend/tests/integration/health.test.js
const request = require('supertest')
const { app } = require('../../src/app')

describe('GET /api/health', () => {
  it('debe retornar ok:true', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.service).toBe('tracking-referidos')
    expect(res.body.ts).toBeDefined()
  })
})
