FROM node:12-alpine AS build

RUN apk add --no-cache git

WORKDIR /build

COPY ./package.json ./package-lock.json ./

RUN npm ci

COPY ./ ./

RUN npx tsc

RUN npm prune --production

FROM node:12-alpine

RUN apk add --no-cache git tini curl # curl needed for healthcheck

WORKDIR /usr/src

COPY --from=build /build/dist ./

COPY --from=build /build ./

EXPOSE 3500

USER node

ENTRYPOINT ["/sbin/tini", "--"]

CMD [ "/usr/local/bin/node",  "-r", "source-map-support/register", "index.js"]
