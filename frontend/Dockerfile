FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# The shared gameplay data the browser bundle imports from ../../../../shared/gameplay.
COPY --from=shared . /shared
RUN npm run build
EXPOSE 5173
CMD ["node", "scripts/serve-static.mjs", "--host", "0.0.0.0", "--port", "5173"]
