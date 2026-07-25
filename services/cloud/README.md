# OnPeople × Sub2API

OnPeople no longer deploys a second cloud wallet or model proxy. The desktop app connects directly to an existing [Sub2API](https://github.com/Wei-Shaw/sub2api) deployment.

Sub2API is the source of truth for:

- email/password registration and login;
- user balance, concurrency, redemption codes, subscriptions, and usage;
- API key creation and group assignment;
- model discovery and `/v1/responses`, `/v1/chat/completions`, image, and other gateway routes;
- upstream account routing, rate limiting, and billing.

OnPeople is responsible only for the desktop experience:

- encrypting the Sub2API access token, refresh token, and API key with Electron `safeStorage`;
- creating a dedicated `OnPeople Desktop` API key after login;
- preferring a Composite group, then OpenAI/Grok, when it must choose an available group;
- showing the Sub2API balance and models;
- preserving third-party Router and local-model settings as an independent per-task choice.

There is no Stripe integration, package checkout, OnPeople wallet, or duplicate usage ledger in this directory.

## Deployment

Run Sub2API using its own Docker deployment. By default OnPeople connects to the hosted OnPeople service:

```text
https://sub2api.aibro.vip
```

Set `SUB2API_URL` to override the packaged/runtime default, or edit the address in the account dialog. Do not append `/api/v1` or `/v1`; OnPeople normalizes either form. Existing installations that still contain the former automatic localhost defaults are migrated to the hosted service, while custom addresses remain unchanged.

The deployment must expose at least:

- `/api/v1/auth/*`
- `/api/v1/auth/me`
- `/api/v1/keys`
- `/api/v1/groups/available`
- `/api/v1/redeem`
- `/v1/models`
- `/v1/responses` and/or `/v1/chat/completions`

For a new user to run models, at least one active group must be available. A Composite group is recommended when one key should expose models from multiple upstream platforms.
