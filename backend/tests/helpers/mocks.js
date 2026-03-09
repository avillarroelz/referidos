// backend/tests/helpers/mocks.js
// Mocks de servicios externos para testing

/**
 * Mock del servicio de Gmail (GmailService).
 * Todas las funciones son jest.fn() que retornan promesas con valores por defecto.
 */
const mockGmailService = {
  initialize: jest.fn().mockResolvedValue(undefined),
  searchEmails: jest.fn().mockResolvedValue([]),
  getEmail: jest.fn().mockResolvedValue({
    id: 'mock-email-id',
    subject: 'Test Email',
    from: 'test@example.com',
    date: new Date().toISOString(),
    body: 'Contenido de prueba',
    attachments: [],
  }),
  markAsRead: jest.fn().mockResolvedValue(undefined),
  addLabel: jest.fn().mockResolvedValue(undefined),
  parseEmailContent: jest.fn().mockResolvedValue({
    nombre: 'Juan Perez',
    rut: '12345678-9',
    telefono: '+56912345678',
    email: 'juan@test.com',
    cargoPostulado: 'Desarrollador',
    observaciones: 'Experiencia en Node.js',
    nombreReferidor: 'Maria Lopez',
  }),
};

/**
 * Mock del servicio S3.
 * Simula operaciones de almacenamiento en la nube.
 */
const mockS3Service = {
  initialize: jest.fn().mockReturnValue(undefined),
  uploadFile: jest.fn().mockResolvedValue({
    key: 'uploads/test-file.pdf',
    location: 'https://s3.amazonaws.com/test-bucket/uploads/test-file.pdf',
  }),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('contenido de prueba')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  getSignedUrl: jest.fn().mockResolvedValue(
    'https://s3.amazonaws.com/test-bucket/uploads/test-file.pdf?signed=true'
  ),
};

/**
 * Mock del parser de emails con IA (Anthropic).
 * Simula la extraccion de datos de CVs y correos.
 */
const mockEmailParserAI = {
  parseEmail: jest.fn().mockResolvedValue({
    nombre: 'Test Candidato',
    rut: '11111111-1',
    telefono: '+56911111111',
    email: 'candidato@test.com',
    cargoPostulado: 'Ingeniero de Software',
    observaciones: 'Candidato de prueba',
    nombreReferidor: 'Referidor Test',
  }),
};

/**
 * Mock del servicio de autenticacion con Google OAuth2.
 */
const mockGoogleAuthService = {
  getAuthUrl: jest.fn().mockReturnValue(
    'https://accounts.google.com/o/oauth2/v2/auth?mock=true'
  ),
  getTokensFromCode: jest.fn().mockResolvedValue({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    id_token: 'mock-id-token',
  }),
  getUserInfo: jest.fn().mockResolvedValue({
    id: 'google-user-123',
    email: 'google-user@gmail.com',
    name: 'Google User',
    picture: 'https://lh3.googleusercontent.com/photo.jpg',
  }),
};

/**
 * Mock del servicio de correo (nodemailer).
 */
const mockMailer = {
  sendMail: jest.fn().mockResolvedValue({
    messageId: 'mock-message-id@test.local',
    accepted: ['destinatario@test.com'],
    rejected: [],
  }),
};

/**
 * Mock del servicio de notificaciones.
 * Replica la interfaz de src/services/notificationService.js
 */
const mockNotificationService = {
  crearNotificacion: jest.fn().mockResolvedValue({
    id: 1,
    tipo: 'test',
    titulo: 'Test',
    mensaje: 'Notificacion de prueba',
  }),
  notificarCambioEstado: jest.fn().mockResolvedValue([]),
  notificarComentario: jest.fn().mockResolvedValue([]),
  notificarAsignacion: jest.fn().mockResolvedValue({
    id: 1,
    tipo: 'asignacion',
    titulo: 'Nuevo Referido Asignado',
  }),
  notificarNuevoReferidoPublico: jest.fn().mockResolvedValue([]),
  notificarSLAVencido: jest.fn().mockResolvedValue([]),
};

/**
 * Resetea todos los mocks a su estado inicial.
 * Util en beforeEach() para limpiar llamadas entre tests.
 */
function resetAllMocks() {
  const allMocks = [
    mockGmailService,
    mockS3Service,
    mockEmailParserAI,
    mockGoogleAuthService,
    mockMailer,
    mockNotificationService,
  ];

  for (const mockObj of allMocks) {
    for (const key of Object.keys(mockObj)) {
      if (typeof mockObj[key]?.mockClear === 'function') {
        mockObj[key].mockClear();
      }
    }
  }
}

module.exports = {
  mockGmailService,
  mockS3Service,
  mockEmailParserAI,
  mockGoogleAuthService,
  mockMailer,
  mockNotificationService,
  resetAllMocks,
};
