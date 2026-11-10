//! Servidor HTTP (axum) sobre la lib `pdf_analyzer`. Contrato: ver SKILL.md de pdf-rust-analyzer
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Query, State, rejection::QueryRejection},
    http::{HeaderMap, StatusCode, header::CONTENT_TYPE},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use pdf_analyzer::{AnalyzeError, analyze_with, has_pdf_magic};
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
/// Plazo extra, después del timeout, antes de dar un análisis por pegado.
const STUCK_AFTER: Duration = Duration::from_secs(60);

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
/// Si `stuck_after` después del timeout el hilo sigue sin terminar, se llama a `on_stuck`: ese
/// cupo no va a volver solo. La vigilancia corre en una tarea aparte desde que parte el hilo,
/// porque axum descarta este future si el cliente corta la conexión.
async fn run_limited<T, F, S>(
    permits: &Arc<Semaphore>,
    queue_wait: Duration,
    timeout: Duration,
    stuck_after: Duration,
    on_stuck: S,
    work: F,
) -> Result<T, Limited>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
    S: FnOnce() + Send + 'static,
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
    let (done, result) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        match tokio::time::timeout(timeout + stuck_after, task).await {
            // Si nadie espera ya la respuesta, el envío falla y no importa.
            Ok(joined) => drop(done.send(joined)),
            Err(_) => on_stuck(),
        }
    });
    match tokio::time::timeout(timeout, result).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(_))) => Err(Limited::Panicked),
        // Venció el plazo (o la vigilancia ya dio el hilo por pegado).
        Ok(Err(_)) | Err(_) => Err(Limited::Timeout),
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
    /// `images=false` omite la extracción de imágenes (por defecto se incluyen).
    images: Option<bool>,
}

/// Un hilo de análisis no se puede cancelar. Si quedó pegado, lo único que devuelve el cupo es
/// terminar el proceso; el orquestador (restart: unless-stopped) lo levanta de nuevo.
fn exit_stuck() {
    let limit = (ANALYZE_TIMEOUT + STUCK_AFTER).as_secs();
    eprintln!("[pdf-analyzer] un análisis lleva más de {limit} s sin terminar: se reinicia el proceso");
    std::process::exit(1);
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

    let with_images = params.images.unwrap_or(true);
    let result = run_limited(&permits, QUEUE_WAIT, ANALYZE_TIMEOUT, STUCK_AFTER, exit_stuck, move || {
        analyze_with(&bytes, params.q.as_deref(), with_images)
    })
    .await;
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

    use std::sync::atomic::{AtomicBool, Ordering};

    const SIN_VIGILANCIA: Duration = Duration::from_secs(3600);

    fn un_cupo() -> Arc<Semaphore> {
        Arc::new(Semaphore::new(1))
    }

    #[tokio::test]
    async fn sin_cupo_responde_ocupado_en_vez_de_encolar_sin_limite() {
        let permits = un_cupo();
        let _tomado = permits.clone().acquire_owned().await.unwrap();

        let r = run_limited(&permits, Duration::from_millis(30), Duration::from_secs(1), SIN_VIGILANCIA, || {}, || 1).await;

        assert!(matches!(r, Err(Limited::Busy)));
    }

    #[tokio::test]
    async fn el_cupo_sigue_tomado_tras_el_timeout_hasta_que_el_trabajo_termina() {
        let permits = un_cupo();

        let r = run_limited(&permits, Duration::from_millis(30), Duration::from_millis(50), SIN_VIGILANCIA, || {}, || {
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

        let r = run_limited(&permits, Duration::from_millis(30), Duration::from_secs(1), SIN_VIGILANCIA, || {}, || -> u8 {
            panic!("pdf hostil")
        })
        .await;

        assert!(matches!(r, Err(Limited::Panicked)));
        assert_eq!(permits.available_permits(), 1);
    }

    #[tokio::test]
    async fn con_cupo_devuelve_el_resultado() {
        let r = run_limited(&un_cupo(), Duration::from_millis(30), Duration::from_secs(1), SIN_VIGILANCIA, || {}, || 7).await;
        assert!(matches!(r, Ok(7)));
    }

    // spawn_blocking no se cancela: un PDF que deje al análisis en bucle retendría el único cupo
    // para siempre. Pasado el plazo extra se avisa (en producción: se termina el proceso y Docker
    // lo levanta de nuevo).
    #[tokio::test]
    async fn un_trabajo_pegado_dispara_el_aviso_tras_el_plazo_extra() {
        let avisado = Arc::new(AtomicBool::new(false));
        let bandera = avisado.clone();

        let r = run_limited(
            &un_cupo(),
            Duration::from_millis(30),
            Duration::from_millis(50),
            Duration::from_millis(400),
            move || bandera.store(true, Ordering::SeqCst),
            || std::thread::sleep(Duration::from_millis(1500)),
        )
        .await;

        assert!(matches!(r, Err(Limited::Timeout)));
        assert!(!avisado.load(Ordering::SeqCst), "no debe avisar antes del plazo extra");
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert!(avisado.load(Ordering::SeqCst));
    }

    // axum descarta el future del handler cuando el cliente corta (p. ej. el backend se reinicia
    // con una petición en vuelo). El hilo sigue pegado igual: la vigilancia no puede depender de
    // que alguien siga esperando la respuesta.
    #[tokio::test]
    async fn la_vigilancia_sigue_aunque_el_cliente_corte_antes_del_timeout() {
        let avisado = Arc::new(AtomicBool::new(false));
        let bandera = avisado.clone();
        let permits = un_cupo();

        let cortado = tokio::time::timeout(
            Duration::from_millis(20),
            run_limited(
                &permits,
                Duration::from_millis(30),
                Duration::from_millis(100),
                Duration::from_millis(200),
                move || bandera.store(true, Ordering::SeqCst),
                || std::thread::sleep(Duration::from_millis(1500)),
            ),
        )
        .await;

        assert!(cortado.is_err(), "el cliente cortó antes del timeout del análisis");
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert!(avisado.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn un_trabajo_lento_que_termina_dentro_del_plazo_extra_no_dispara_el_aviso() {
        let avisado = Arc::new(AtomicBool::new(false));
        let bandera = avisado.clone();

        let r = run_limited(
            &un_cupo(),
            Duration::from_millis(30),
            Duration::from_millis(50),
            Duration::from_millis(600),
            move || bandera.store(true, Ordering::SeqCst),
            || std::thread::sleep(Duration::from_millis(200)),
        )
        .await;

        assert!(matches!(r, Err(Limited::Timeout)));
        tokio::time::sleep(Duration::from_millis(900)).await;
        assert!(!avisado.load(Ordering::SeqCst));
    }
}
