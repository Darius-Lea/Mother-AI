# Render web preview

Render runs the web preview; the downloadable desktop app runs Electron on a person's computer. The repository remains an unpublished first-release preview.

## Existing Render service

Deploy the latest `main` commit. Recommended service settings:

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check: `/api/health`
- Node: `24.19.0` (also pinned in `.node-version` and the package engine range)

Render supplies `PORT`, `RENDER=true`, and its external hostname. Mother binds to `0.0.0.0`, uses that port, and accepts that exact hostname. Add custom domains through `MOTHER_ALLOWED_HOSTS` when necessary; do not use wildcard host access.

For an existing service retaining the original settings, two compatibility steps are included: `npm install` automatically builds the frontend when `RENDER=true`, and the legacy command `node desktop/main.cjs` delegates to the web server under ordinary Node without importing Electron. It therefore avoids the original undefined `protocol.registerSchemesAsPrivileged` failure. The explicit commands above remain preferable.

`render.yaml` supplies a free web-service blueprint for a new service. Its build includes development dependencies needed by Vite, skips the desktop Electron download, and starts `npm start`. The blueprint does not automatically overwrite an existing service's dashboard settings.

## What the hosted preview provides

- Live responsive 3D particle interface and mobile installable web shell.
- Clearly labeled offline guide, local conversation memory, exports/imports and feedback.
- Browser-local dataset-file review, file fingerprints, and code pattern checks.
- Direct installer downloads from the approved GitHub preview channel, discovered through its verified catalog. No GitHub login, ZIP extraction, or source-code page is required. A Render checkout does not contain desktop installer binaries.

The public preview does not operate the web host's filesystem, install models, create app grants, execute security tools, or inspect arbitrary URLs. Those APIs return an explicit denial before contacting local services. Public health metadata describes these capabilities so the interface can show the appropriate controls. Desktop mode keeps the protected local capabilities.

A free Render web service does not include an Ollama runtime, model weights, GPU, or a secure bridge to the visitor's computer. The hosted guide must not be presented as neural inference. Install and configure the desktop app for actual local-model conversations. Public multi-user neural hosting would require a separate authenticated deployment and suitable compute.

## Verify a deployment

Open the service URL and its `/api/health` path. Health should report `ok:true` and `mode:"hosted-preview"`. `/api/models` should explicitly report no hosted model. The app should load its built JavaScript and CSS, display the hosted-preview notice, and keep browser-local features available. `/api/workspace/status`, `/api/setup/status`, `/api/integrations` and `/api/security/capabilities` must be denied in hosted mode.

The deployment test starts the exact original failing entry command under Render environment variables and verifies health without loading Electron. Backend tests also verify host configuration and that private endpoints never call local services in hosted mode. Current-instance simulation is distinct from a confirmed live Render deployment; inspect the actual service after its redeploy completes.
