//! Servidor HTTP (axum) sobre la lib `pdf_analyzer`. Contrato: ver SKILL.md de pdf-rust-analyzer
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use pdf_analyzer::{AnalyzeError, analyze, has_pdf_magic};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

const MAX_BODY_BYTES: usize = 20 * 1024 * 1024;
const ANALYZE_TIMEOUT: Duration = Duration::from_secs(30);
/// Cuánto espera una petición por un cupo antes de recibir 503.
const QUEUE_WAIT: Duration = Duration::from_secs(10);
const DEFAULT_MAX_CONCURRENCY: usize = 2;

enum Limited {
    /// No hubo cupo dentro de la espera (HTTP 503).
    Busy,
    /// El trabajo superó el plazo (HTTP 504); el hilo sigue y conserva su cupo.
    Timeout,
    /// El trabajo terminó en panic (HTTP 400).
    Panicked,
}

/// Ejecuta `work` en un hilo bloqueante con concurrencia acotada.
/// El cupo viaja DENTRO del hilo: spawn_blocking no se cancela, así que tras un timeout el
/// análisis sigue corriendo y su cupo sigue tomado hasta que termina de verdad. Sin eso, una
/// ráfaga de PDFs lentos acumularía hilos sin límite aunque cada cliente ya recibió su 504.
async fn run_limited<T, F>(permits: &Arc<Semaphore>, queue_wait: Duration, timeout: Duration, work: F) -> Result<T, Limited>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let permit = match tokio::time::timeout(queue_wait, permits.clone().acquire_owned()).await {
        Ok(Ok(permit)) => permit,
        _ => return Err(Limited::Busy),
    };
    // spawn_blocking aísla los panics de lopdf/pdf-extract (llegan como JoinError).
    let task = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work()
    });
    match tokio::time::timeout(timeout, task).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => Err(Limited::Panicked),
        Err(_) => Err(Limited::Timeout),
    }
}

/// Error de API: siempre se serializa como `{ "error": "<mensaje corto>" }`.
struct ApiError(StatusCode, &'static str);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

#[derive(Deserialize)]
struct AnalyzeParams {
    q: Option<String>,
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "backend": "rust" }))
}

fn is_pdf_content_type(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/pdf"))
}

async fn analyze_handler(
    State(permits): State<Arc<Semaphore>>,
    headers: HeaderMap,
    params: Result<Query<AnalyzeParams>, QueryRejection>,
    body: Body,
) -> Result<Response, ApiError> {
    // El Content-Type se valida antes de leer el body.
    if !is_pdf_content_type(&headers) {
        return Err(ApiError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "Content-Type debe ser application/pdf"));
    }
    let Query(params) = params.map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Parámetros de consulta inválidos"))?;
    let bytes = to_bytes(body, MAX_BODY_BYTES)
        .await
        .map_err(|_| ApiError(StatusCode::PAYLOAD_TOO_LARGE, "El body supera 20 MB"))?;
    if !has_pdf_magic(&bytes) {
        return Err(ApiError(StatusCode::UNSUPPORTED_MEDIA_TYPE, "El body no es un PDF"));
    }

    let result = run_limited(&permits, QUEUE_WAIT, ANALYZE_TIMEOUT, move || analyze(&bytes, params.q.as_deref())).await;
    match result {
        Ok(Ok(analysis)) => Ok(Json(analysis).into_response()),
        Ok(Err(AnalyzeError::Parse)) | Err(Limited::Panicked) => {
            Err(ApiError(StatusCode::BAD_REQUEST, "No se pudo procesar el PDF"))
        }
        Ok(Err(AnalyzeError::ResourceLimit)) => {
            Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "El PDF supera el límite de recursos"))
        }
        Err(Limited::Busy) => Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "El analizador está ocupado")),
        Err(Limited::Timeout) => Err(ApiError(StatusCode::GATEWAY_TIMEOUT, "El análisis superó 30 s")),
    }
}

#[tokio::main]
async fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "4002".into());
    // Sin autenticación: por defecto solo loopback. HOST=0.0.0.0 es solo para un contenedor
    // en red privada y sin puertos publicados.
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let max_concurrency = std::env::var("MAX_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_MAX_CONCURRENCY);
    let app = Router::new()
        .route("/health", get(health))
        .route("/analyze", post(analyze_handler))
        .with_state(Arc::new(Semaphore::new(max_concurrency)));
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}"))
        .await
        .expect("no se pudo abrir el puerto");
    println!("pdf-analyzer escuchando en http://{host}:{port} (concurrencia máxima: {max_concurrency})");
    axum::serve(listener, app).await.expect("el servidor terminó con error");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn un_cupo() -> Arc<Semaphore> {
        Arc::new(Semaphore::new(1))
    }

    #[tokio::test]
    async fn sin_cupo_responde_ocupado_en_vez_de_encolar_sin_limite() {
        let permits = un_cupo();
        let _tomado = permits.clone().acquire_owned().await.unwrap();

        let r = run_limited(&permits, Duration::from_millis(30), Duration::from_secs(1), || 1).await;

        assert!(matches!(r, Err(Limited::Busy)));
    }

    #[tokio::test]
    async fn el_cupo_sigue_tomado_tras_el_timeout_hasta_que_el_trabajo_termina() {
        let permits = un_cupo();

        let r = run_limited(&permits, Duration::from_millis(30), Duration::from_millis(50), || {
            std::thread::sleep(Duration::from_millis(400))
        })
        .await;

        // El cliente ya recibió el timeout, pero el hilo sigue: no puede entrar otro análisis.
        assert!(matches!(r, Err(Limited::Timeout)));
        assert_eq!(permits.available_permits(), 0);
        tokio::time::sleep(Duration::from_millis(600)).await;
        assert_eq!(permits.available_permits(), 1);
    }

    #[tokio::test]
    async fn un_panic_del_trabajo_libera_el_cupo() {
        let permits = un_cupo();

        let r = run_limited(&permits, Duration::from_millis(30), Duration::from_secs(1), || -> u8 {
            panic!("pdf hostil")
        })
        .await;

        assert!(matches!(r, Err(Limited::Panicked)));
        assert_eq!(permits.available_permits(), 1);
    }

    #[tokio::test]
    async fn con_cupo_devuelve_el_resultado() {
        let r = run_limited(&un_cupo(), Duration::from_millis(30), Duration::from_secs(1), || 7).await;
        assert!(matches!(r, Ok(7)));
    }
}
