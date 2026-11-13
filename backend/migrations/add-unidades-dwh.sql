-- Migración: unidades de negocio desde el DWH (DataWhoreHouse)
-- Fecha: 2026-11-13
--
-- Primer paso de la sincronización con el DWH (odd/tasks/sync-dwh-unidades-adc.md):
-- 1) unidad_negocio gana la llave natural del ERP (codigo_empresa, codigo_unidad) y
--    el origen del registro ('manual' = creada en la app, 'dwh' = viene del DWH).
--    La sincronización diaria futura solo tocará las filas 'dwh'.
-- 2) Carga inicial: las 27 unidades ACTIVAS de Ecora S.A. (empresa 01) en
--    core.dim_unidad_negocio al 2026-11-13. Se excluyen las sintéticas DSV* del DWH
--    y las de otras empresas del grupo (decisión de Alejandro, 2026-11-13).
--    'BAÑO' se corrige aquí: en el DWH llega dañado desde Unysoft.
--
-- Idempotente: se puede correr más de una vez (no duplica ni pisa cambios).

ALTER TABLE unidad_negocio ADD COLUMN IF NOT EXISTS codigo_empresa VARCHAR(10);
ALTER TABLE unidad_negocio ADD COLUMN IF NOT EXISTS codigo_unidad  VARCHAR(20);
ALTER TABLE unidad_negocio ADD COLUMN IF NOT EXISTS origen         VARCHAR(10) NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  ALTER TABLE unidad_negocio ADD CONSTRAINT unidad_negocio_origen_chk CHECK (origen IN ('manual', 'dwh'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS unidad_negocio_codigo_uk
  ON unidad_negocio (codigo_empresa, codigo_unidad)
  WHERE codigo_unidad IS NOT NULL;

INSERT INTO unidad_negocio (nombre, descripcion, estado, codigo_empresa, codigo_unidad, origen, created_at, updated_at) VALUES
  ('ADMINISTRACION', 'Código Unysoft A010100000', true, '01', 'A010100000', 'dwh', now(), now()),
  ('REVESTIMIENTO PLANTA DE FILTRO', 'Código Unysoft C010500000', true, '01', 'C010500000', 'dwh', now(), now()),
  ('REFORZAMIENTO SALA ELECTRICA ER 06', 'Código Unysoft C024800000', true, '01', 'C024800000', 'dwh', now(), now()),
  ('CONSTRUCCION COMEDOR BAÑO SALA DE CAMBIO LC', 'Código Unysoft C024900000', true, '01', 'C024900000', 'dwh', now(), now()),
  ('INFRAESTRUCTURA ARQUITECTURA E INGENIERIA', 'Código Unysoft C025000000', true, '01', 'C025000000', 'dwh', now(), now()),
  ('HABILITACION PABELLON 19 VCA', 'Código Unysoft C025300000', true, '01', 'C025300000', 'dwh', now(), now()),
  ('OVERHAUL DE TALLERES Y OFICINAS SECTOR 3.5', 'Código Unysoft C025400000', true, '01', 'C025400000', 'dwh', now(), now()),
  ('CAPTACION LECHO FILTRANTE', 'Código Unysoft C025500000', true, '01', 'C025500000', 'dwh', now(), now()),
  ('REHABILITACION CAMPAMENTO 5400', 'Código Unysoft C025800000', true, '01', 'C025800000', 'dwh', now(), now()),
  ('LOOP DE DISTRIBUCION DE AGUA COLOSO', 'Código Unysoft C025900000', true, '01', 'C025900000', 'dwh', now(), now()),
  ('MATERIAL PARTICULADO COLOSO', 'Código Unysoft C026000000', true, '01', 'C026000000', 'dwh', now(), now()),
  ('CAMBIO DE LINEA ACIDO_RED INCENDIO', 'Código Unysoft C028000000', true, '01', 'C028000000', 'dwh', now(), now()),
  ('PROYECTOS OP. E INF. CRITICA MOD2 FIJO', 'Código Unysoft C030200000', true, '01', 'C030200000', 'dwh', now(), now()),
  ('PROYECTOS OP. E INF. CRITICA MOD1 VARIABLE', 'Código Unysoft C030300000', true, '01', 'C030300000', 'dwh', now(), now()),
  ('MEJORAMIENTO CALETA DE PESCADORES COLOSO', 'Código Unysoft C052000000', true, '01', 'C052000000', 'dwh', now(), now()),
  ('Edificio Av. Argentina', 'Código Unysoft E030200000', true, '01', 'E030200000', 'dwh', now(), now()),
  ('PROYECTOS MANTENCION MEL', 'Código Unysoft L020300000', true, '01', 'L020300000', 'dwh', now(), now()),
  ('SERVICIO DE REPARACIONES CIVILES ESTRUCTURALES TR', 'Código Unysoft L022500000', true, '01', 'L022500000', 'dwh', now(), now()),
  ('SRCE 2026 AL 2027', 'Código Unysoft L022600000', true, '01', 'L022600000', 'dwh', now(), now()),
  ('SERVICIO DE OBRAS CIVILES Y MANTENIMIENTO DE INFRAESTRUCTURA MENOR', 'Código Unysoft L022800000', true, '01', 'L022800000', 'dwh', now(), now()),
  ('CUADRILLA ELECTRICA GEOLOGIA', 'Código Unysoft L022900000', true, '01', 'L022900000', 'dwh', now(), now()),
  ('TALLERES Y PORTONES 2024 AL 2029', 'Código Unysoft L023000000', true, '01', 'L023000000', 'dwh', now(), now()),
  ('PROYECTOS CUADRILLA ELECTRICA', 'Código Unysoft L023200000', true, '01', 'L023200000', 'dwh', now(), now()),
  ('TECNOLOGIA E INNOVACION VIDEOANALITICA', 'Código Unysoft L023300000', true, '01', 'L023300000', 'dwh', now(), now()),
  ('PROYECTOS SRCE', 'Código Unysoft L023400000', true, '01', 'L023400000', 'dwh', now(), now()),
  ('PORTONES CODELCO DCH', 'Código Unysoft L040100000', true, '01', 'L040100000', 'dwh', now(), now()),
  ('SUBCONTRATOS', 'Código Unysoft Z060100000', true, '01', 'Z060100000', 'dwh', now(), now())
ON CONFLICT DO NOTHING;
