FROM node:10-alpine

RUN apk add --no-cache git tini curl # curl needed for healthcheck

WORKDIR /usr/src

COPY package.json package-lock.json ./

RUN npm i -production

COPY ./dist ./

EXPOSE 3500

USER node

ENTRYPOINT ["/sbin/tini", "--"]

CMD [ "/usr/local/bin/node",  "-r", "source-map-support/register", "index.js"]
