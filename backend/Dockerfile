# Multi-stage Dockerfile for AccessCore Backend
# Stage 1: Build TypeScript source code
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build

# Stage 2: Production runtime image
FROM node:22-alpine AS runner

WORKDIR /app

# Install curl for container health checks
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=4000

# Security: Create non-root system user
RUN addgroup -g 1001 -S nodejs && adduser -S accesscore -u 1001

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled JavaScript, migrations, and synthetic assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY assets ./assets

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && chown -R accesscore:nodejs /app

USER accesscore

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=15s \
  CMD curl -f http://localhost:4000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

