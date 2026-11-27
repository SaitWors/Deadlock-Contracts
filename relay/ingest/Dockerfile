FROM rust:1.98-slim-trixie@sha256:fce83543909cd5409924a61ce296bdf5bab0fca37f004c0f6c8ef6f4a37bbc59 AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git build-essential clang cmake pkg-config libssl-dev protobuf-compiler libprotobuf-dev \
    && rm -rf /var/lib/apt/lists/*
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true RUSTUP_TOOLCHAIN=1.98.1
WORKDIR /src

FROM build AS verify
RUN rustup component add rustfmt clippy
COPY . .
ENV CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo fmt --all -- --check \
    && cargo clippy --locked --bin deadlock-api-ingest -- -D warnings \
    && cargo test --locked --bin deadlock-api-ingest gc::

FROM build AS release
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo build --locked --release --bin deadlock-api-ingest \
    && cp target/release/deadlock-api-ingest /deadlock-api-ingest

FROM debian:trixie-slim@sha256:ab3b3c8c5159eebfca4376430132d53c4d425f869c765ecbe47177a030da575d AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3t64 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o 65532 -g 65532 /var/lib/ingest
LABEL org.opencontainers.image.source="https://github.com/SaitWors/Deadlock-Contracts" \
      org.opencontainers.image.description="Deadlock API Ingest for Contract Relay" \
      org.opencontainers.image.licenses="MIT"
COPY --from=release /deadlock-api-ingest /usr/local/bin/deadlock-api-ingest
COPY --from=release /src/LICENSE /usr/share/doc/deadlock-api-ingest/LICENSE
ENV HOME=/var/lib/ingest
WORKDIR /app
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/deadlock-api-ingest", "--no-memory"]
