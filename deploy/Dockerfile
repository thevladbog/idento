# syntax=docker/dockerfile:1
# Combined P5 cutover image: panel/ at /, console (web/) at /super-admin/.
# Build context is the REPO ROOT (panel source-imports @idento/ui via npm
# workspaces; web/ is a standalone package).

# Stage 1 — panel (workspace build; needs packages/)
FROM node:24-alpine AS build-panel
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
COPY panel ./panel
RUN npm ci && npm run build -w panel

# Stage 2 — console (web/ is NOT a workspace member: own package.json + lock)
FROM node:24-alpine AS build-web
WORKDIR /web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci
COPY web ./
RUN npm run build

# Stage 3 — one unprivileged nginx serving both
FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root
COPY --chown=nginx:nginx --from=build-panel /src/panel/dist /usr/share/nginx/html
COPY --chown=nginx:nginx --from=build-web   /web/dist        /usr/share/nginx/html/super-admin
# Explicit chown: the base image's html dir pre-exists owned by root and
# COPY --chown only touches entries it creates, so the envsubst entrypoint
# (unprivileged UID 101) can't write env.js into it without this.
RUN chown nginx:nginx /usr/share/nginx/html /usr/share/nginx/html/super-admin
USER nginx
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# envsubst mirrors template subpaths into the output dir → the console's
# template lands at super-admin/env.js.
COPY panel/env.js.template /etc/nginx/templates/env.js.template
COPY web/env.js.template   /etc/nginx/templates/super-admin/env.js.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
EXPOSE 8080
