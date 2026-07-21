FROM ghcr.io/railwayapp/nixpacks:ubuntu-1745885067

ENTRYPOINT ["/bin/bash", "-l", "-c"]
WORKDIR /app/

COPY .nixpacks/nixpkgs-ffeebf0acf3ae8b29f8c7049cd911b9636efd7e7.nix .nixpacks/nixpkgs-ffeebf0acf3ae8b29f8c7049cd911b9636efd7e7.nix
RUN nix-env -if .nixpacks/nixpkgs-ffeebf0acf3ae8b29f8c7049cd911b9636efd7e7.nix && nix-collect-garbage -d

ARG CI COOLIFY_BRANCH COOLIFY_FQDN COOLIFY_RESOURCE_UUID COOLIFY_URL MONGODB_URI NIXPACKS_METADATA NODE_ENV NPM_CONFIG_PRODUCTION
ENV CI=$CI COOLIFY_BRANCH=$COOLIFY_BRANCH COOLIFY_FQDN=$COOLIFY_FQDN COOLIFY_RESOURCE_UUID=$COOLIFY_RESOURCE_UUID COOLIFY_URL=$COOLIFY_URL MONGODB_URI=$MONGODB_URI NIXPACKS_METADATA=$NIXPACKS_METADATA NODE_ENV=$NODE_ENV NPM_CONFIG_PRODUCTION=$NPM_CONFIG_PRODUCTION

# setup phase
# noop

# install phase
ENV NIXPACKS_PATH=/app/node_modules/.bin:$NIXPACKS_PATH
COPY . /app/.
RUN --mount=type=cache,id=bswsooo4okwkckc0swsgccog-/root/npm,target=/root/.npm npm i --legacy-peer-deps

# build phase
COPY . /app/.
RUN --mount=type=cache,id=bswsooo4okwkckc0swsgccog-node_modules/cache,target=/app/node_modules/.cache npm run build

RUN printf '\nPATH=/app/node_modules/.bin:$PATH' >> /root/.profile

# start
COPY . /app

# FIXED: Fixed JSON execution syntax & changed 'dev' to 'start:prod' for production environments
CMD ["npm", "run", "start:prod"]