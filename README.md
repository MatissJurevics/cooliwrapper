# cooliwrapper

Small HTTP API that accepts a ZIP file, extracts it safely, and creates Coolify resources on `coolify.mati.ss`.

## Default Flow

Static HTML ZIPs are the default.

When a ZIP contains `index.html`, the wrapper:

- finds the shallowest `index.html`
- reads its `<title>`
- stores the extracted site under `uploads/static-sites/<title-slug>-<id>`
- creates a new Coolify Dockerfile application named from that title
- serves the site with `nginx`

Coolify's API does not currently expose direct static ZIP/file upload. This wrapper uses the closest API-only path: it generates a Dockerfile containing the static site archive and sends it to Coolify's Dockerfile application endpoint.

## Setup

```bash
cp .env.example .env
npm install
npm start
```

Required Coolify values:

- `COOLIFY_TOKEN`: a Coolify API token from Keys & Tokens. It needs write permissions for create/update/deploy operations.
- `COOLIFY_BASE_URL`: defaults to `https://coolify.mati.ss`.
- `COOLIFY_PROJECT_UUID`
- `COOLIFY_SERVER_UUID`
- `COOLIFY_ENVIRONMENT_NAME` or `COOLIFY_ENVIRONMENT_UUID`
- `COOLIFY_DESTINATION_UUID`

Optional:

- `WRAPPER_API_KEY`: when set, clients must send `x-api-key: <key>` or `Authorization: Bearer <key>`.
- `STATIC_SITE_DOMAIN_SUFFIX`: when set, domains are derived from the HTML title, for example `launch-page-a1b2c3d4.example.com`.
- `MAX_STATIC_ARCHIVE_BYTES`: compressed static site limit for the generated Dockerfile payload. Default is `26214400`.

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

Response includes:

- `local.title`: title read from `index.html`
- `local.resourceSlug`: Coolify resource name derived from the title
- `local.path`: extracted copy stored under this project
- `coolify`: Coolify API response

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
    "domains": "https://launch-page.example.com"
  }
}
```

If `STATIC_SITE_DOMAIN_SUFFIX=example.com`, an `index.html` titled `Launch Page` becomes something like:

```text
https://launch-page-a1b2c3d4.example.com
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
