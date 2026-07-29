FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS web-build

WORKDIR /source

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY index.html postcss.config.js tailwind.config.js vite.config.js ./
COPY src/ ./src/
RUN npm run build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime

WORKDIR /app

COPY deploy/server/package.json deploy/server/package-lock.json deploy/server/.npmrc ./
RUN npm ci --omit=dev

COPY deploy/server/src/ ./src/
COPY deploy/server/migrations/ ./migrations/
COPY --from=web-build /source/dist/ ./dist/

# SQLite DB directory - mounted as a named volume in Compose.
RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "src/index.js"]
