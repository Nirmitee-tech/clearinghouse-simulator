FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY ui ./ui
COPY templates ./templates
COPY stubs ./stubs
ENV CM_INBOUND=/data/inbound CM_OUTBOUND=/data/outbound CM_PORT=8090
EXPOSE 8090
CMD ["node", "src/index.js"]
