# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (not panel/): the panel source-imports
# @idento/ui through npm workspaces, so the image build needs packages/.
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY packages ./packages
COPY panel ./panel
RUN npm ci
RUN npm run build -w panel

# Unprivileged nginx + envsubst env.js — same proven pattern as web/Dockerfile
# (see the comment block there for why the explicit chown is required).
FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root
COPY --chown=nginx:nginx --from=build /src/panel/dist /usr/share/nginx/html
RUN chown nginx:nginx /usr/share/nginx/html
USER nginx
COPY panel/nginx.conf /etc/nginx/conf.d/default.conf
COPY panel/env.js.template /etc/nginx/templates/env.js.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
EXPOSE 8080
