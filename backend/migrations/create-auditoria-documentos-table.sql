-- Migración: tabla de auditoría de documentos de candidatos
-- Fecha: 2026-09-09
--
-- Hasta ahora no quedaba traza de ningún borrado de documentos: ni de RRHH, ni
-- de ADMIN, ni del propio postulante. estado_historial solo registra cambios de
-- estado del BPM, así que un expediente podía quedar vacío sin que nadie pudiera
-- decir quién lo vació, cuándo ni con qué título.
--
-- Ley 21.719: sin esta traza no hay forma de responder quién eliminó datos
-- personales de un candidato, ni de resolver el reclamo de quien fue rechazado
-- y pregunta qué se evaluó.

CREATE TABLE IF NOT EXISTS auditoria_documentos (
    id              SERIAL PRIMARY KEY,

    -- SIN clave foránea a propósito: la fila de documentos se borra en la misma
    -- operación que genera este registro. Una FK en cascada eliminaría la
    -- auditoría junto con aquello de lo que debe dar testimonio.
    documento_id    INTEGER      NOT NULL,

    referido_id     INTEGER      NOT NULL REFERENCES referidos(id),

    -- Nullable: deja espacio a un borrado ejecutado por un proceso automático.
    actor_user_id   INTEGER      REFERENCES usuarios(id),

    accion          VARCHAR(20)  NOT NULL,

    -- Tras el borrado, estos dos campos son la única forma de saber QUÉ se
    -- eliminó: la fila del documento ya no existe.
    nombre_archivo  VARCHAR(255),
    s3_key          TEXT,

    -- Con qué título se autorizó el borrado (privilegiado | creador |
    -- postulante). Responde la pregunta de cumplimiento, que no es solo quién
    -- eliminó el dato sino con qué legitimación lo hizo.
    via_acceso      VARCHAR(20),

    -- VARCHAR(45) para que quepa una IPv6 completa.
    ip              VARCHAR(45),

    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- "Qué se borró de este expediente y cuándo": la consulta de un reclamo.
CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_referido
    ON auditoria_documentos (referido_id, created_at DESC);

-- "Qué eliminó esta persona": la consulta de Ley 21.719 y la de un incidente.
CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_actor
    ON auditoria_documentos (actor_user_id, created_at DESC);

-- No se indexa `accion`: mientras tenga un solo valor no discrimina nada. Se
-- agrega cuando se registren varias acciones distintas.
