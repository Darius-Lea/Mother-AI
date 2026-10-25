# Connect another app to Mother

Mother now exposes an authenticated local API for apps that implement its protocol. A permission grant means that an app is allowed to connect; the panel shows a successful-use timestamp only after a real chat or code-review request completes. This is a real connection surface, not a claim of built-in support for every vendor. It provides local neural chat/coding through an installed model and bounded static code-pattern review. It does not grant shell execution, file access, private browser memories, device control, or external-account access.

## User flow

1. Open Mother's app connections panel.
2. Name the compatible app, select its permissions, and approve the grant.
3. Copy the one-time token into the app's private Mother integration settings.
4. Use the displayed local endpoint. You can revoke the app at any time.

For most existing apps, the app developer or a trusted adapter needs to implement this API first. A web page must not embed app tokens in public frontend code. Native desktop apps, local trusted services, and private server-side adapters can call it. Browser CORS remains restricted. Remote hosted services cannot directly call a user's localhost.

The desktop service uses an ephemeral port. Find the current endpoint in Mother's panel after restarting; tokens persist, but the port may change. Desktop discovery/third-party vendor adapters remain separate development work. Nothing silently searches for devices or accesses user accounts.

## Registry and permissions

Mother saves app grant metadata and SHA-256 hashes of high-entropy random bearer tokens in `integrations.json` under the runtime data directory supplied by the host. The default standalone location is `MOTHER_DATA_DIR` or `~/.mother-ai`; desktop hosts should supply their private application data directory. Writes use a private temporary file and atomic rename. Raw tokens are not written to that registry and are returned only when the user creates the grant. Metadata endpoints never expose hashes. Broken registries produce an error instead of silently discarding existing grants.

Supported scopes:

| Scope | API capability |
| --- | --- |
| `chat` | Send user/assistant messages to a selected installed local neural model. |
| `code:review` | Run local static pattern checks over supplied text. Nothing is executed. |

Revocation stops new authenticated requests; an already running request may finish. Anyone who obtains a token and can reach the loopback endpoint can use that token's features. Keep tokens in the integrating app's private configuration. This prototype does not provide public multi-tenant hosting, billing, rate-limit quotas, or a license enforcement service.

## Administration API

These routes must stay behind the host application's owner/session authorization. `createIntegrationRouters` denies admin requests by default; the host must supply a trusted `requireAdmin` middleware.

- `GET /api/integrations`: list grant summaries and available scope names, never tokens or hashes.
- `GET /api/integrations/info`: discover the current HTTP loopback endpoint and its restart behavior.
- `POST /api/integrations` with `{ "name": "My editor", "scopes": ["chat"] }`: returns `{ connection, token }` once.
- `DELETE /api/integrations/:id`: revoke a grant.

Integration bearer tokens cannot access these administration routes.

## App API

All requests below require `Authorization: Bearer <app token>`. Requests with missing, forged, revoked, or insufficiently scoped credentials receive an error before the model is called. Existing Host, same-origin, content-type, and body-size protections still apply.

- `GET /api/connect/status`: reports granted scopes and actual local model availability.
- `POST /api/connect/chat`: requires `chat`; accepts the same bounded `{ model, messages, context? }` format as Mother's chat API. System-role messages are rejected. The supplied callback invokes the real local model; missing models return explicit failure rather than simulated answers.
- `POST /api/connect/review`: requires `code:review`; accepts `{ source }` up to 200,000 characters and returns findings with line numbers. `engine` is `local-static-patterns`, and `neural` is false.

No conversation or source is persisted by these routes. The local model service may have its own runtime behavior; review it separately. App grants are persisted and successful use updates the grant's last-used timestamp.

### Private local JavaScript adapter

Supply `MOTHER_ENDPOINT` and `MOTHER_APP_TOKEN` through your app's private runtime configuration. The token comes from Mother's explicit connection grant. The displayed endpoint can change when the desktop app restarts.

```js
const endpoint = process.env.MOTHER_ENDPOINT;
const token = process.env.MOTHER_APP_TOKEN;
const response = await fetch(`${endpoint}/api/connect/chat`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    model: 'YOUR_INSTALLED_MODEL',
    messages: [{ role: 'user', content: 'Explain this function and suggest improvements.' }],
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error);
console.log(result.message.content);
```

The static review endpoint can work without a neural model:

```js
const response = await fetch(`${endpoint}/api/connect/review`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ source: 'eval(userInput);' }),
});
const report = await response.json();
```

This detects patterns; it does not prove a program secure or replace an authorized security audit.
