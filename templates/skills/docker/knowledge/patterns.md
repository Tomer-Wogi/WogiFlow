# docker — Successful Patterns

Best practices for working with docker.

---

## Multi-Stage Build

**Context**: Minimizing production image size

**Example**:
```
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
```

**Why it works**: Build tools and source stay in builder stage, production image is minimal

---

## Layer Caching for Dependencies

**Context**: Faster rebuilds

**Example**:
```
COPY package*.json ./
RUN npm ci
# Source changes don't invalidate dependency layer
COPY . .
```

**Why it works**: Copying package files first lets Docker cache the npm install layer

---

