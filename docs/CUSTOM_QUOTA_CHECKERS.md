# Custom Quota Checkers

Custom quota checkers let an admin monitor a provider that does not have a
built-in Plexus checker. A checker is a JavaScript function body stored in the
database and run in a worker with a 10-second timeout.

Custom checkers are intended for trusted administrators. Worker isolation
protects the Plexus process from hangs and many execution errors, but it is not
a security sandbox for untrusted code.

## Create a checker

1. Open **Providers** in the Admin UI.
2. Select **Custom Quota Checkers**.
3. Select **New checker**.
4. Enter a unique **Type / ID** and a display name.
5. Paste a JavaScript function body into **JavaScript function body**.
6. Select a provider and use **Test code** to run the current draft without
   saving a quota snapshot.
7. Save the checker.
8. Edit a provider, select the custom checker in its **Quota Checker** field,
   configure its request settings, and save the provider.

The new checker type appears in the provider editor after it is saved and
enabled. The checker type is plain text, so custom types do not require a code
change, enum update, or frontend component.

## OpenRouter starter example

New checkers start with a working OpenRouter account-credits example. It calls
OpenRouter's credits endpoint, sends the provider API key as a Bearer token,
and returns a USD balance meter.

```js
const response = await ctx.fetch(
  ctx.getOption('endpoint', 'https://openrouter.ai/api/v1/credits'),
  {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  },
);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();
const totalCredits = Number(data?.data?.total_credits);
const totalUsage = Number(data?.data?.total_usage);
if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) {
  throw new Error('OpenRouter returned an invalid credits response');
}
return [
  ctx.balance({
    key: 'balance',
    label: 'Account credits',
    unit: 'usd',
    limit: totalCredits,
    used: totalUsage,
    remaining: totalCredits - totalUsage,
  }),
];
```

For this example, edit the OpenRouter provider and select the custom checker.
Leave **Request endpoint** blank to use the default above. Keep:

- **Authentication header**: `Authorization`
- **Authentication prefix**: `Bearer`
- **Send the provider API key in this header**: enabled

The provider's API key is inherited automatically and is never displayed in
the custom checker editor.

## Provider request settings

Request settings are configured on the provider assignment, not globally on
the checker definition. This allows one checker to be reused with different
providers or credentials.

| Setting | Purpose |
| --- | --- |
| Request endpoint | Available to code as `options.endpoint`; the checker chooses whether to use it. |
| Authentication header | Header receiving the provider API key, default `Authorization`. |
| Authentication prefix | Prefix before the key, default `Bearer`; leave blank for a raw key. |
| Send the provider API key in this header | Enables automatic API-key injection; enabled by default. |
| Additional request headers | JSON object merged into requests, for example `{"X-Client": "plexus"}`. |
| Other options | JSON values for provider-specific settings used with `ctx.getOption()`. |

Use `ctx.fetch()` for requests that should receive these settings. Headers
passed in the request's `init` object override configured headers.

```js
const response = await ctx.fetch(ctx.getOption('endpoint', 'https://example.com/quota'), {
  method: 'GET',
  headers: { Accept: 'application/json' },
});
```

`fetch()` by itself does **not** apply the provider key or configured headers.
If code must use the ambient `fetch`, pass the configured headers explicitly:

```js
const response = await fetch('https://example.com/quota', {
  headers: ctx.requestHeaders(),
});
```

## Checker context

The checker body receives one `ctx` object:

| API | Description |
| --- | --- |
| `ctx.checkerId` | Configured checker instance ID. |
| `ctx.provider` | Provider slug being checked. |
| `ctx.options` | Provider-specific options object. |
| `ctx.getOption(key, defaultValue)` | Reads an option and uses the default when absent. |
| `ctx.requireOption(key)` | Reads an option or throws a helpful error when absent. |
| `ctx.fetch(input, init?)` | Fetches a URL with configured headers and authentication. |
| `ctx.requestHeaders()` | Returns configured headers, including the provider API key when enabled. |
| `ctx.balance(params)` | Creates a balance meter. |
| `ctx.allowance(params)` | Creates a rate or usage allowance meter. |

The body may be asynchronous and must return an array containing only meters
created by `ctx.balance()` or `ctx.allowance()`.

## Meter formats

### Balance

Use a balance for credits, dollars, or another amount that is depleted toward
zero.

```js
return [
  ctx.balance({
    key: 'credits',
    label: 'Account credits',
    unit: 'usd',
    limit: 100,
    used: 25,
    remaining: 75,
  }),
];
```

Required fields are `key`, `label`, and `unit`. `limit`, `used`, `remaining`,
`group`, `scope`, and `exhaustionThreshold` are optional.

### Allowance

Use an allowance for a request, token, or other rate limit.

```js
return [
  ctx.allowance({
    key: 'requests_hourly',
    label: 'Hourly requests',
    unit: 'requests',
    periodValue: 1,
    periodUnit: 'hour',
    periodCycle: 'rolling',
    limit: 1000,
    used: 250,
    remaining: 750,
    resetsAt: '2026-08-22T21:00:00.000Z',
  }),
];
```

Required allowance fields are `key`, `label`, `unit`, `periodValue`,
`periodUnit`, and `periodCycle`. `periodUnit` is one of `minute`, `hour`,
`day`, `week`, or `month`. `periodCycle` is `fixed` or `rolling`.

## Testing and errors

**Test code** executes the current editor contents against the selected
provider. It does not save the checker or persist a meter snapshot, so it is
safe to use while developing a checker. The provider's API key is still
available to `ctx.fetch()` during the test.

The runtime reports these failures separately:

- **Syntax error** — the JavaScript function body cannot be compiled.
- **Runtime error** — the body throws, returns a non-array, or returns an
  invalid meter.
- **Timeout** — execution takes longer than 10 seconds and the worker is
  terminated.
- **HTTP error** — provider responses should be checked with `response.ok` and
  converted into a useful error message.

When scheduled, failed checks are retained as failed quota results and do not
produce meters. Successful meters participate in the same cooldown and quota
display behavior as built-in checkers.

## JavaScript limitations

- JavaScript only in the current release; TypeScript is not supported.
- Paste a function body, not a complete module. Do not use `import` or npm
  package imports.
- Use `ctx.fetch()` or `ctx.requestHeaders()` when request authentication or
  configured headers are needed.
- Do not hard-code provider secrets into checker source. Use the provider API
  key or provider options instead.
- Custom checker code runs with the permissions of the Plexus process. Only
  trusted administrators should be allowed to create or edit checkers.

## Management API

All custom checker endpoints require the `x-admin-key` header:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v0/management/custom-checkers` | List custom checkers. |
| `GET` | `/v0/management/custom-checkers/{id}` | Get one checker. |
| `PUT` | `/v0/management/custom-checkers/{id}` | Create or replace a checker. |
| `PATCH` | `/v0/management/custom-checkers/{id}` | Update a checker. |
| `DELETE` | `/v0/management/custom-checkers/{id}` | Delete a checker. |
| `POST` | `/v0/management/custom-checkers/{id}/test` | Test code without persisting a snapshot. |
| `POST` | `/v0/management/custom-checkers/{id}/check` | Run the saved checker immediately. |

Example create request:

```bash
curl -X PUT http://localhost:4000/v0/management/custom-checkers/openrouter-custom \
  -H 'x-admin-key: your-admin-password' \
  -H 'Content-Type: application/json' \
  -d '{
    "displayName": "OpenRouter Custom",
    "code": "return [ctx.balance({key: \"credits\", label: \"Credits\", unit: \"usd\", remaining: 10})];",
    "enabled": true
  }'
```

See the [API Reference](openapi/openapi.yaml) for request and response
schemas.
