FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies first, so this layer is cached between code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

# Do not run as root inside the container.
USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Apply migrations, load sample data (safe to repeat), then start the API.
CMD ["sh", "-c", "node src/db/migrate.js up && node src/db/seed.js && node src/server.js"]
