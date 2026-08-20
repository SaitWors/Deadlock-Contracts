FROM node:22-alpine AS frontend-build

WORKDIR /frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable \
    && pnpm install --frozen-lockfile
COPY frontend ./
RUN pnpm build

FROM python:3.13.7-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /nonexistent --shell /usr/sbin/nologin app

COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt \
    && python -m pip check

COPY --chown=app:app app ./app
RUN rm -rf /app/app/static/assets /app/app/static/index.html /app/app/static/app.js \
    && mkdir -p /app/app/static/assets /app/runtime/evidence \
    && chown -R app:app /app/app/static /app/runtime
COPY --from=frontend-build --chown=app:app /frontend/dist/index.html ./app/static/index.html
COPY --from=frontend-build --chown=app:app /frontend/dist/assets ./app/static/assets

USER 10001:10001
EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips=*", "--no-server-header", "--no-access-log", "--workers", "1"]
