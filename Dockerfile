FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY README.md SPEC.md ./
COPY docs ./docs
COPY src ./src

RUN mkdir -p /app/uploads/static-sites \
  && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
