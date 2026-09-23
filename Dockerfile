# ==============================================================================
# Production Multi-Stage Dockerfile for College Event Registration System
# ==============================================================================

# Build Stage
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build production server bundle
COPY . .
RUN npm run build

# Production Runner Stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built server bundle and frontend assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend ./frontend

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

# Health check to ensure service vitality
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the optimized production bundle
CMD ["node", "dist/server.cjs"]
