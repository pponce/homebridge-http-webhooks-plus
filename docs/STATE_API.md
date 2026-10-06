# Garage and lock state API

Use the optional JSON state API to report garage-door and lock state, read status,
and request HomeKit state notifications. This reference describes API v1 in
HTTP Webhooks Plus 0.5.0. The original query-string webhooks remain available;
both interfaces use the same per-accessory state settings. Node.js 18 or newer
is required.

## Configuration

In Homebridge UI, open the plugin Settings, then Webhook Devices and
the individual garage or lock entry. State and feedback, Notifications, and
Advanced HTTP settings apply separately to that entry. The shared token is under
Webhook Settings > Incoming state API; legacy response mode is under
Compatibility. The token protects this platform’s shared API, not a single
accessory. The v1 routes support garage-door and lock accessories.

One server has a device-specific URL for each accessory ID: clients POST to
`/v1/accessories/{percent-encoded-id}/state`. Multiple clients can use these
endpoints with the shared token, but separate per-client/per-device tokens are
not supported. The token grants access across the supported accessories; it does
not restrict a client to the ID it normally uses. Device command URLs (open,
close, etc.) are outgoing requests with their own per-command headers. The state
API token is never automatically attached to those outgoing requests.

The form displays saved values and schema defaults. Leaving State source or
Startup state unset uses the defaults described below. A garage configured with
`external_state: true` uses external mode when `state_mode` is omitted. Defaults
need not appear in config.json until explicitly saved.


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
| `response_max_bytes` | 65536 | 1024–1048576; total command response body limit, including redirects. |
| `max_redirects` | 0 | 0–5; follow this many same-origin redirects. 0 disables redirects. |

Garage `external_state` is a boolean alternative to `state_mode`: `true` selects
external mode and `false` selects optimistic mode. If both settings are supplied
they must agree. Locks use `state_mode` directly.
The required garage obstruction characteristic remains present, defaults to
false for virtual use, and can be explicitly set/cleared. Locks have no obstruction.
See [feedback freshness](#feedback-freshness) for optional state expiry and
independent obstruction monitoring.

Example platform fragment (add your generated `state_api_token` to enable the API):

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
Commands are never automatically retried. Redirects are disabled unless
`max_redirects` is configured. Feedback expiry marks state unavailable; it does
not infer that an accessory has moved.

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
Back up both directories. Saving each snapshot as a single update prevents
partial multi-field writes and leaves other accessories' storage untouched.
The original garage and lock cache entries are no longer updated. After a
downgrade, they can contain outdated values; restore an appropriate backup and
obtain fresh state reports before relying on them.

Persistence failure returns 503, marks getters unavailable and requires restart
and storage repair; it never claims success. A failure after file rename is
ambiguous, so restart revalidates the entire old/new snapshot. HAP publication
failure returns `hap_update_failed_state_stored`; committed state is not rolled
back or misrepresented as uncommitted. Notification delivery is not transactional.

All errors have bounded fixed codes, with no request/response/credential dump.
Malformed input returns 400, authentication 401, missing route/accessory 404,
wrong method 405, oversized body 413, wrong content type 415, storage/HAP failure
503. Incoming requests default to a 10-second deadline, v1 bodies to an 8192-byte
limit, and ignored query-string webhook bodies to a 65536-byte limit. Configure
these with platform `webhook_timeout_ms`, `state_api_body_max_bytes`, and
`webhook_body_max_bytes`; see [HTTP settings](../README.md#shared-http-and-logging-controls)
for their ranges. Headers are bounded by Node's HTTP server limits.

## Original webhook compatibility

Legacy `?accessoryId=...` garage/lock field names still work. By default their
response retains previous values in `currentState`, `targetState`, `obstruction`
for supplied fields. Values are now normalized types. Setting platform
`webhook_response_mode: "applied"` selects the v1 response shape for these legacy
routes. The v1 routes always return applied state. Other families retain their
existing response contracts and runtime implementations.

Query-string `force_notify=true` uses the same explicit notification policy; its
`notified` is true only when every supplied field's explicit event was requested.
Use v1 to distinguish disabled, partial and throttled outcomes.

Command headers are JSON objects with string values. Forms accept flat JSON
objects with string, finite number, or boolean values. Methods, URLs, body sizes
and limits are checked at startup without exposing secret values. TLS verification
stays on unless `rejectUnauthorized: false`. All command accessory types use the
same HTTP/HTTPS transport. Redirects are disabled by default; `max_redirects`
allows up to five same-origin redirects.


## Feedback freshness

Per accessory `feedback_timeout_seconds` is 0 by default (disabled), or a finite
number up to 604800 seconds. Only successful current-state reports renew it.
A successful optimistic command may store assumed state but cannot renew or
recover expired feedback. Requests with any invalid field do not renew any timer.
Garage-only `obstruction_monitoring` defaults false; when true obstruction starts
unavailable even with use_cache. `obstruction_timeout_seconds` is independently
0 (disabled) through 604800 and a positive value requires monitoring. A valid
obstruction report alone renews that timer. Both legacy and v1 reports qualify.

Availability adds `stale`; stored state and observation timestamps remain intact.
Getters/characteristics report communication errors until fresh reports arrive.
The plugin never invents physical position or obstruction from timeouts. Status
capabilities add `feedbackFreshness`, `feedbackTimeoutSeconds`,
`obstructionMonitoring` and `obstructionTimeoutSeconds`. Status reads never renew
freshness. Runtime deadlines use a monotonic clock; persisted wall-clock timestamps
are diagnostic only. With use_cache and a timeout, startup grants one unverified
grace period. With await_feedback, current state stays unavailable until reported.
Timers stop on shutdown and persistence failure. Transitions are logged once.
