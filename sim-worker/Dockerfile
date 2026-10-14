FROM node:20-slim
WORKDIR /app/sim-worker
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
# engine-version.json is optional (npm run version:write). The glob jso[n] matches nothing when it is absent;
# package.json always matches, so the COPY succeeds either way and the version falls back to git, then "unknown".
COPY package.json engine-version.jso[n] ./
COPY --from=shared . /app/shared
USER node
EXPOSE 8090
CMD ["node", "src/index.js"]
