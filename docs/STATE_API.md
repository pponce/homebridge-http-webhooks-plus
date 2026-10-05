# Garage and lock state API v1 (0.3.0)

The state API is optional and generic. It does not require a particular controller,
actuator or sensor. Existing IDs, names, platform aliases, service types and
characteristic UUIDs are unchanged. Node 18 or newer is required.

## Configuration

In Homebridge UI (0.3.1+), open the plugin Settings, then Webhook Devices and
the individual garage or lock entry. State and feedback, Notifications, and
Advanced HTTP settings apply separately to that entry. The shared token is under
Webhook Settings > Incoming state API; legacy response mode is under
Compatibility. The token protects this platform’s shared API, not a single
accessory. No state API is enabled for other families in this release.

One server has a device-specific URL for each accessory ID: clients POST to
`/v1/accessories/{percent-encoded-id}/state`. Multiple clients can use these
endpoints with the shared token, but separate per-client/per-device tokens are
not supported. The token grants access across the supported accessories; it does
not restrict a client to the ID it normally uses. Device command URLs (open,
close, etc.) are outgoing requests with their own per-command headers. The state
API token is never automatically attached to those outgoing requests.

The form displays saved values and schema defaults. State source and Startup
state may remain unset to preserve their contextual defaults described below;
opening the form must not change an external_state-only garage to optimistic.
Defaults need not appear in config.json until explicitly saved. Existing
integrations may guard configuration and require a coordinated settings update.


Add a randomly generated `state_api_token` (32–256 URL-safe letters, digits,
underscores or hyphens) to the platform to enable `/v1/` routes. Send it as the
`X-Webhooks-Token` header, never in a URL. If Basic authentication is configured,
send that too. Use HTTPS on untrusted networks. Existing legacy routes retain
Basic authentication and do not acquire a token requirement.

Garage and lock entries support these options:

| Option | Default | Behavior |
| --- | --- | --- |
| `state_mode` | `optimistic` | `optimistic` assumes completion after HTTP success; `external` changes current state only on feedback. |
| `startup_state_policy` | `use_cache` for optimistic; `await_feedback` for external | `use_cache` explicitly permits unverified cached values/defaults. `await_feedback` returns HAP communication errors until a field is reported (or target requested). |
| `notification_policy` | `changes_only` | `allow_explicit` permits the client to request reaffirmation. |
| `notification_min_interval_ms` | 1000 | 100–60000; per-field limit for repeated identical explicit events. Changes always propagate. |
| `request_timeout_ms` | 10000 | 100–60000; total command deadline, including response reading. |
| `response_max_bytes` | 65536 | 1024–1048576; command response body bound. |

Garage `external_state: true/false` is a migration alias for external/optimistic.
If both settings are supplied they must agree. Locks use `state_mode` directly.
The required garage obstruction characteristic remains present, defaults to
false for virtual use, and can be explicitly set/cleared. Locks have no obstruction.
Separate obstruction monitoring and stale-feedback timers are not in 0.3.0.

Example platform fragment (fill the token privately; do not publish it):

```json
{
  "platform": "HttpWebHooks",
  "webhook_port": "51828",
  "webhook_listen_host": "127.0.0.1",
  "garagedooropeners": [{
    "id": "sample-garage", "name": "Sample Garage",
    "state_mode": "external", "notification_policy": "allow_explicit",
    "open_url": "http://127.0.0.1:8080/open",
    "close_url": "http://127.0.0.1:8080/close"
  }]
}
```

Omitting command URLs supports purely virtual accessories. A HomeKit target SET
is a command; a webhook target update is a report and **never** calls a command
URL. External command success means acceptance, not completion or physical
position. Overlapping commands and reports supersede late optimistic results;
a late SET whose target differs from the current target returns an error.
There are no automatic command retries, redirects or timers that invent state.

## Routes and values

- `GET /v1/accessories/{percent-encoded-id}` returns status and capabilities.
- `POST /v1/accessories/{percent-encoded-id}/state` accepts a flat JSON object,
  content type `application/json`, containing one or more state fields and
  optional `notify: true`.

| Field | Garage | Lock |
| --- | --- | --- |
| `currentState` | 0 Open, 1 Closed, 2 Opening, 3 Closing, 4 Stopped | 0 Unsecured, 1 Secured, 2 Jammed, 3 Unknown |
| `targetState` | 0 Open, 1 Closed | 0 Unsecured, 1 Secured |
| `obstruction` | Boolean | Not supported |

Current and target are independent. Numeric fields accept integers or canonical
unsigned decimal strings. Boolean fields accept true/false, 1/0 and those exact
lowercase strings. Zero and false are valid. Empty strings, whitespace, arrays,
objects, duplicate keys (including escaped equivalents), unknown fields,
non-finite numbers and invalid enums fail before any field changes. Accessory IDs
must be unique across all families because routing uses ID alone.

A successful response includes `success`, `apiVersion: 1`, `package` (name and
version), `accessoryId`, `type`, `state`, `observedAt`, `availability`, and
`capabilities`. Updates also include `previous` and `notification`:

```json
{
  "requested": true,
  "outcome": "sent",
  "fields": {"currentState": "sent", "targetState": "sent"}
}
```

Outcomes are `not_requested`, `disabled`, `sent`, `rate_limited`, or `partial`
when fields differ. `sent` means the HAP event was requested, **not** that a phone
received/rendered it. The client owns any repeat scheduling. A throttled request
still stores valid state and observations. Mixed obstruction changes and repeated
door events are processed together; throttling cannot discard obstruction.

`observedAt` contains report timestamps, not physical-sensor proof. Status reads,
commands and invalid requests do not renew observations. Availability distinguishes
`observed`, `requested`, `assumed`, `default`, `unverified_cache`,
`awaiting_feedback` and `storage_error`. Inspect availability before trusting
`state`: awaiting fields retain a non-authoritative cached/default value for
inspection. Startup waiting uses supported HAP read errors; it does not invent a
garage Unknown enum. Exact Home display and stale timeouts are separate concerns.

## Persistence and errors

Each garage/lock uses one validated in-memory snapshot, atomically persisted
before characteristics are updated. On first use it imports the existing
`http-webhook-*` state keys without deleting them. Subsequent snapshots live in
**`<resolved cache_directory>.plus-state-v1/`**, a sibling of node-persist's cache.
Back up both directories. This deliberate storage migration prevents partial
multi-key writes and leaves unrelated accessories' storage untouched. Old keys
are no longer updated for these two families: downgrading requires a reviewed
state restore or fresh feedback, not blindly treating old keys as current.

Persistence failure returns 503, marks getters unavailable and requires restart
and storage repair; it never claims success. A failure after file rename is
ambiguous, so restart revalidates the entire old/new snapshot. HAP publication
failure returns `hap_update_failed_state_stored`; committed state is not rolled
back or misrepresented as uncommitted. Notification delivery is not transactional.

All errors have bounded fixed codes, with no request/response/credential dump.
Malformed input returns 400, authentication 401, missing route/accessory 404,
wrong method 405, oversized body 413, wrong content type 415, storage/HAP failure
503. Requests have a 10-second deadline; v1 bodies are limited to 8192 bytes,
legacy ignored bodies to 65536. Headers are bounded by Node's HTTP server limits.

## Legacy compatibility

Legacy `?accessoryId=...` garage/lock field names still work. By default their
response retains previous values in `currentState`, `targetState`, `obstruction`
for supplied fields. Values are now normalized types. Setting platform
`webhook_response_mode: "applied"` selects the v1 response shape for these legacy
routes. The v1 routes always return applied state. Other families retain their
existing response contracts and runtime implementations.

Legacy `force_notify=true` maps to explicit notification permission; legacy
`notified` is true only when every supplied field's explicit event was requested.
Use v1 to distinguish disabled, partial and throttled outcomes.

Garage/lock headers and forms are validated JSON objects with string values;
methods, URLs, body sizes and bounds are checked at startup without exposing
secret values. TLS verification stays on unless `rejectUnauthorized: false`.
These command paths use Node's bounded HTTP transport and do not redirect.
Other families still use the older shared transport in this release.
