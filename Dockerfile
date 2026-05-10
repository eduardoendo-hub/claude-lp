# ─────────────────────────────────────────────────────────────────────
# Stage 1 — build: roda os injectors Node pra processar o index.html
# (sem isso, mudancas em inject-tracking.js / inject-extras.js /
#  tracking-config.json nunca chegam ao HTML servido — bug recorrente)
# ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /build
COPY . .
RUN node inject-tracking.js && node inject-extras.js

# ─────────────────────────────────────────────────────────────────────
# Stage 2 — runtime: nginx servindo os arquivos ja processados
# ─────────────────────────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=builder /build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Remove os scripts de build do nginx (nao precisam ser servidos)
RUN rm -f /usr/share/nginx/html/inject-extras.js \
          /usr/share/nginx/html/inject-tracking.js \
          /usr/share/nginx/html/Dockerfile
EXPOSE 80
