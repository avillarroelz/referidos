# Analizador de PDF (Rust) — sidecar del backend de Referidos
FROM rust:1.92-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY tests ./tests
COPY fixtures ./fixtures
# Los tests corren en el target real (Linux): si fallan, no hay imagen.
RUN cargo test --release --locked && cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --system --no-create-home --uid 10001 pdf
COPY --from=build /src/target/release/pdf-analyzer /usr/local/bin/pdf-analyzer
USER pdf
# Dentro del contenedor escucha en todas las interfaces; el aislamiento lo da
# docker-compose (red interna, sin puertos publicados). El servicio no tiene autenticación.
ENV HOST=0.0.0.0
ENV PORT=4002
EXPOSE 4002
CMD ["pdf-analyzer"]
