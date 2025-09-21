# Build container for Rocket.Chat Apps CLI
# This isolates the vulnerable lodash.template dependency from production
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY plugin/package.json plugin/package-lock.json* ./plugin/
COPY shared/package.json shared/package-lock.json* ./shared/

# Install @rocket.chat/apps-cli and dependencies in isolation
RUN cd plugin && npm install --save-dev @rocket.chat/apps-cli@^1.12.1

# Install shared dependencies
RUN cd shared && npm install

# Copy source code
COPY plugin/ ./plugin/
COPY shared/ ./shared/

# Build shared package first
RUN cd shared && npm run build

# Build and package the plugin
WORKDIR /app/plugin
RUN npm run compile
RUN npx rc-apps package

# Output stage - extract only the built package
FROM alpine:latest
WORKDIR /output
COPY --from=builder /app/plugin/*.zip ./
CMD ["ls", "-la", "/output/"]