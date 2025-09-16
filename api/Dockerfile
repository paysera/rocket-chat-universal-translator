FROM node:20-alpine

WORKDIR /app

# Copy shared dependencies first
COPY shared ../shared

# Copy API package files and install dependencies
COPY api/package*.json ./
RUN npm ci

# Copy API source code and build
COPY api .
RUN npm run build

# Remove dev dependencies after build
RUN npm ci --omit=dev && npm cache clean --force

EXPOSE 3001

CMD ["node", "dist/server.js"]