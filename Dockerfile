FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY ui ./ui
COPY templates ./templates
COPY stubs ./stubs
# A writable state directory owned by the non-root user the compose file runs as.
RUN mkdir -p /app/data && chown -R 1001:1001 /app/data
ENV CM_INBOUND=/data/inbound CM_OUTBOUND=/data/outbound CM_STATE_DIR=/app/data CM_PORT=8090
EXPOSE 8090
CMD ["node", "src/index.js"]
