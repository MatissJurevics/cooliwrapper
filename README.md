# cooliwrapper

Small HTTP API that accepts a ZIP file, extracts it safely, and creates Coolify resources on `coolify.mati.ss`.

Public deployment: `https://uigendeploy.mati.ss`

Public docs endpoint: `https://uigendeploy.mati.ss/docs`

Full API and behavior spec: [SPEC.md](./SPEC.md)

TSP generator integration guide: [docs/tsp-deployment-api.md](./docs/tsp-deployment-api.md)

## Default Flow

Static HTML ZIPs are the default.

The ZIP must contain already-built browser assets. For Vite/React apps, upload `dist/` after `npm run build`, not the source project. An `index.html` that references `/src/main.tsx`, `.ts`, `.tsx`, or `.jsx` entrypoints is rejected because browsers cannot run those files directly from nginx.

When a ZIP contains `index.html`, the wrapper:

- finds the shallowest `index.html`
- reads its `<title>`
- validates that referenced local scripts, stylesheets, module preloads, and favicons exist and are browser-ready
- stores the extracted site under `uploads/static-sites/<title-slug>-<id>`
- writes a compressed build artifact under `uploads/artifacts`
- creates a new Coolify Dockerfile application named from that title
- assigns a domain matching `https://<resource-slug>.mati.ss`
- serves the site with `nginx`

Coolify's API does not currently expose direct static ZIP/file upload. This wrapper uses the closest API-only path: it generates a small Dockerfile that downloads a tokenized static-site artifact from this wrapper during the Coolify build.

## Setup

```bash
cp .env.example .env
npm install
npm start
```

For local Docker Compose:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

`docker-compose.yml` is Coolify-safe and does not publish host port `3000`. Coolify should route traffic through its proxy to the container's internal port `3000`.

Required Coolify values:

- `COOLIFY_TOKEN`: a Coolify API token from Keys & Tokens. It needs write permissions for create/update/deploy operations.
- `COOLIFY_BASE_URL`: defaults to `https://coolify.mati.ss`.
- `COOLIFY_PROJECT_UUID`
- `COOLIFY_SERVER_UUID`
- `COOLIFY_ENVIRONMENT_NAME` or `COOLIFY_ENVIRONMENT_UUID`
- `COOLIFY_DESTINATION_UUID`

Optional:

- `WRAPPER_API_KEY`: when set, clients must send `x-api-key: <key>` or `Authorization: Bearer <key>`.
- `STATIC_SITE_DOMAIN_SUFFIX`: deployment domain suffix. Defaults to `mati.ss`, so domains are derived from the HTML title, for example `launch-page-a1b2c3d4.mati.ss`.
- `PUBLIC_BASE_URL`: public URL used by Coolify builds to download generated artifacts. In production this is `https://uigendeploy.mati.ss`.
- `MAX_STATIC_ARCHIVE_BYTES`: compressed static site artifact size limit. Default is `26214400`.

## Finding Coolify UUIDs

After setting `COOLIFY_TOKEN`, run:

```bash
curl http://localhost:3000/coolify/discovery \
  -H "x-api-key: $WRAPPER_API_KEY"
```

Use:

- `projects[].uuid` for `COOLIFY_PROJECT_UUID`
- `servers[].uuid` for `COOLIFY_SERVER_UUID`
- `environments[].name` for `COOLIFY_ENVIRONMENT_NAME`, usually `production`
- the Docker network destination UUID from Coolify for `COOLIFY_DESTINATION_UUID`

If the destination UUID is not visible in the discovery response, copy it from the Coolify UI when selecting the destination, or from an existing resource configured for that same destination.

## API

### `GET /health`

Checks the wrapper process.

### `GET /docs`

Public browser-friendly integration docs. This route does not require the wrapper API key.

Related docs endpoints:

- `GET /docs/api.md`: raw deployment API spec.
- `GET /docs/tsp-deployment-api.md`: raw TSP generator integration guide.
- `GET /docs/openapi.json`: OpenAPI document for client tooling.

### `GET /coolify/health`

Checks Coolify reachability.

### `GET /coolify/discovery`

Lists projects, servers, resources, and environments visible to the configured token.

### `POST /deployments`

Multipart form upload.

Fields:

- `zip`: required `.zip` file.
- `manifest`: optional JSON object. Overrides `coolify.json` inside the ZIP.

Static HTML example:

```bash
curl -X POST http://localhost:3000/deployments \
  -H "x-api-key: $WRAPPER_API_KEY" \
  -F "zip=@./static-site.zip"
```

If an uploaded ZIP contains `index.html`, the wrapper treats it as a static HTML artifact and deploys it through Coolify's Dockerfile application API, even if a compose file is also present. Send an explicit manifest with `"type": "service"` to force the Docker Compose service path.

Response includes:

- `local.title`: title read from `index.html`
- `local.resourceSlug`: Coolify resource name derived from the title
- `local.path`: extracted copy stored under this project
- `coolify`: Coolify API response

### `POST /tsp-deployments`

Uploads a `.tsp` archive, validates the generated Python backend at `services/api`, and creates a new Coolify Dockerfile application on port `8080`.

```bash
curl -X POST https://uigendeploy.mati.ss/tsp-deployments \
  -H "x-api-key: $WRAPPER_API_KEY" \
  -F "tsp=@./backend.tsp"
```

The generated Dockerfile downloads a tokenized TSP artifact from this wrapper during the Coolify build, installs the generated API package with `uv`, and starts:

```bash
python -m app
```

Legacy archives that use `repository/services/api` are still accepted as a fallback.

The backend deployment writes the backend port into the Coolify domain value, for example `http://<resource-slug>.mati.ss:8080`.

The current generated TSP backend uses SQLite by default. For durable production data, point the generated backend at an external database or adjust the generated backend/container to use persistent storage.

## Static Manifest Overrides

Static HTML ZIPs do not need a manifest. You can still pass one to override Coolify fields:

```json
{
  "type": "static-html",
  "coolify": {
    "project_uuid": "project-uuid",
    "server_uuid": "server-uuid",
    "environment_name": "production",
    "destination_uuid": "destination-uuid",
    "domains": "https://launch-page.mati.ss"
  }
}
```

If `STATIC_SITE_DOMAIN_SUFFIX=mati.ss`, an `index.html` titled `Launch Page` becomes something like:

```text
https://launch-page-a1b2c3d4.mati.ss
```

## Other Supported Modes

Docker Compose ZIPs are still supported. If the ZIP contains `docker-compose.yml`, `compose.yml`, `docker-compose.yaml`, or `compose.yaml`, it creates a Coolify service.

```json
{
  "type": "service",
  "name": "my-service",
  "composeFile": "docker-compose.yml",
  "coolify": {
    "project_uuid": "project-uuid",
    "server_uuid": "server-uuid",
    "environment_name": "production",
    "destination_uuid": "destination-uuid"
  }
}
```

Existing resources can also be redeployed:

```json
{
  "type": "deploy",
  "uuid": "resource-uuid",
  "force": true
}
```
