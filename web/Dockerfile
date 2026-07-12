# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Unprivileged nginx (runs as UID 101, listens on 8080) — Trivy DS-0002.
# PUBLIC_API_URL is injected at container start (not build time): the base
# image's default entrypoint chain runs envsubst on *.template files under
# /etc/nginx/templates before nginx starts, writing the substituted output
# to NGINX_ENVSUBST_OUTPUT_DIR — pointed here at the static html root so
# env.js.template becomes a real env.js the frontend can fetch.
# The container runs as unprivileged UID 101 (nginx). /usr/share/nginx/html
# already exists in the base image owned by root, and COPY --chown only sets
# ownership on the entries it creates — not on that pre-existing directory —
# so without the explicit chown below the envsubst entrypoint script fails
# with "not writable" and env.js is never generated.
FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root
COPY --chown=nginx:nginx --from=build /src/dist /usr/share/nginx/html
RUN chown nginx:nginx /usr/share/nginx/html
USER nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY env.js.template /etc/nginx/templates/env.js.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
EXPOSE 8080
