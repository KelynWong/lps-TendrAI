# TendrAI API — multi-stage build for ECS Fargate (linux/amd64)
FROM node:22.23.4-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.23.4-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
# RDS CA bundle so TLS to PostgreSQL is verified (rds.force_ssl = 1)
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
ENV DB_SSL_CA_PATH=/etc/ssl/rds-global-bundle.pem
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
