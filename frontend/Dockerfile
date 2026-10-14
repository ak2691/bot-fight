FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Shared browser/worker engine (repo shared/ folder), supplied by the "shared" build context
COPY --from=shared . /shared
RUN npm run build
EXPOSE 5173
CMD ["node", "scripts/serve-static.mjs", "--host", "0.0.0.0", "--port", "5173"]
