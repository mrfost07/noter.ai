# syntax=docker/dockerfile:1
# Build the actual application from a clean checkout; no host frontend build is needed.
FROM node:24-alpine AS frontend
WORKDIR /src/web
RUN corepack enable && corepack prepare pnpm@11.0.1 --activate
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
COPY web/patches/ ./patches/
RUN --mount=type=cache,id=noter-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY web/ ./
RUN pnpm release

FROM golang:1.27.3-alpine AS backend
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
COPY --from=frontend /src/server/frontend/dist ./server/frontend/dist
ARG VERSION
ARG COMMIT=unknown
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -tags netgo,osusergo \
      -ldflags="-s -w -X github.com/usememos/memos/internal/version.Version=${VERSION:-$(date -u +%y.%m)} -X github.com/usememos/memos/internal/version.Commit=${COMMIT}" \
      -o /out/noter ./cmd/memos

FROM alpine:3.24 AS runtime
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -g 10001 -S noter && adduser -u 10001 -S -G noter -h /data noter && \
    mkdir -p /data/profile /data/library && chown -R noter:noter /data
COPY --from=backend /out/noter /usr/local/bin/noter
COPY LICENSE /usr/share/licenses/noter/LICENSE
ENV MEMOS_ADDR=0.0.0.0 MEMOS_PORT=8081 MEMOS_DRIVER=sqlite \
    MEMOS_DATA=/data/profile NOTER_LIBRARY_ROOT=/data/library HOME=/data
USER 10001:10001
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=12 \
    CMD wget -q -O /dev/null http://127.0.0.1:8081/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/noter"]
