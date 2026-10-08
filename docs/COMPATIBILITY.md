# Upgrading to HTTP Webhooks Plus

This guide covers moving from `homebridge-http-webhooks` to
`homebridge-http-webhooks-plus`, and updating an existing Plus installation.
It describes compatibility with Plus 0.6.0. See the [changelog](../CHANGELOG.md)
for individual releases and the [README](../README.md) for configuration examples.

## What stays the same

- The platform name remains `HttpWebHooks`.
- Existing accessory aliases, IDs, names, and HomeKit service types are retained.
- Existing webhook URLs and command URL placeholders continue to work.
- Garage doors and locks use optimistic state updates by default: a successful
  outgoing command updates the displayed current state.
- External feedback, feedback expiry, explicit notifications, and the JSON state
  API are optional. You can enable them after upgrading.

Keep your existing platform configuration, accessory IDs and names, cache path,
and main or child bridge identity. You do not need to remove accessories from
Apple Home, clear cached accessories, or pair the bridge again for a standard
upgrade using `"platform": "HttpWebHooks"`.

## Before upgrading

Use Node.js 18 or newer and a Homebridge version supported by the plugin:
Homebridge 1.8.4 or later in the 1.x series, or a compatible 2.x version.

Back up your Homebridge configuration, pairing data, and persistent storage with
your usual backup method. Include the plugin's `cache_directory` if it is stored
separately. For an existing Plus installation, also include its sibling
`<resolved cache_directory>.plus-state-v1/` directory.

Check the behavior changes below, particularly if command URLs redirect or
webhook clients rely on permissive state-value parsing.

### Package-qualified configuration

Most installations use the unqualified `"platform": "HttpWebHooks"` identifier.
If yours uses `homebridge-http-webhooks.HttpWebHooks`, the package prefix can
contribute to Homebridge's accessory identity. Review how to preserve that
identity before changing the prefix. The same applies to package-qualified
standalone accessory aliases. A search-and-replace of the package name across
configuration and persistent storage can recreate accessories.

## Replace the original package

1. Save a backup and a copy of your existing plugin configuration.
2. Replace `homebridge-http-webhooks` with `homebridge-http-webhooks-plus` using
   Homebridge UI or the same package manager and installation location you use
   for other Homebridge plugins. The packages share registration aliases, so
   only one should be loaded when Homebridge starts.
3. Retain the existing `HttpWebHooks` configuration and bridge identity. If your
   Homebridge configuration has a `plugins` allowlist or `disabledPlugins` list,
   update the relevant package entry to `homebridge-http-webhooks-plus`.
4. Restart Homebridge and check the log for successful plugin and accessory loading.
5. Confirm your accessories remain in their rooms, scenes, and automations.
   Check a webhook update and a usual accessory action before enabling new options.

Installation locations differ between containers, packaged installations, and
global npm. Install into the location used by the running Homebridge instance.

If you already use Plus, update it through your existing plugin installation
method and restart Homebridge. Keep the existing configuration and cache.

## Behavior changes to review

### HTTP commands

All command accessories use Node.js HTTP/HTTPS requests with a default 10-second
deadline and a 64 KiB response limit. Adjust `request_timeout_ms` and
`response_max_bytes` per accessory when needed. Commands are never automatically
retried.

Redirects are disabled by default. Set `max_redirects` to 1–5 to follow redirects
within the same origin (scheme, host, and port). Cross-origin redirects and changes
to URL credentials are rejected. A 301/302 redirect for POST, or a 303 response
except for HEAD, changes the request to GET; 307/308 preserve its method and body.

Use either a raw body or a form for each command. Forms accept flat JSON objects
with string, finite number, or boolean values. Nested objects and arrays are
rejected. Existing accessory families that sent bodies only for POST, PUT, and
PATCH retain that behavior. URL-based Basic authentication and explicit
Authorization headers remain supported.

TLS certificate verification is enabled by default. The existing
`rejectUnauthorized` setting controls verification for outgoing requests.

### Configuration and state validation

Version 0.6.0 replaces the flattened 0.5.1 form with a custom configuration UI.
Use **Devices → Add device** to create an accessory, or **Edit** beside an
existing device. Commands, feedback, notifications, and advanced settings are
grouped per device. **Apply changes** stages a device edit; **Save settings**
writes the complete configuration through Homebridge UI. Restart the child
bridge after saving. The host’s generic Save button is disabled so it cannot
bypass this page’s validation.

Empty lists stay empty until you explicitly add a device or stateless switch
button. Untouched values and unknown options are retained, including other
configuration blocks and `_bridge` metadata. All schema settings remain
available. The legacy `external_state` alias is reflected in State source;
changing that selection keeps an existing alias consistent. No accessory IDs,
cache files, bridge identities, or pairing data are migrated.

Existing rows containing only form defaults and no ID are ignored at startup
with a warning identifying the array and zero-based row index. You can remove
these unused rows in the configuration editor. Startup does not rewrite the
configuration. A row with a name, command URL, custom setting or another
non-default value still requires a valid ID and is never silently discarded.
The optional `state_api_token` may remain configured when there are no garage
doors, locks, or other accessories; this does not prevent startup.

Incomplete Basic authentication credentials and TLS certificate/key pairs are
rejected at startup. Invalid command settings and out-of-range limits are also
reported as configuration errors. Supply both members of a pair or neither.

Accessory IDs must be unique across all accessory types because incoming webhooks
select an accessory by ID. Garage and lock state updates validate the entire
request before applying changes. Invalid values are rejected; valid zero and
false values are applied correctly. See [accepted state values](STATE_API.md#routes-and-values).

### Garage and lock responses

The original query-string webhooks remain available. By default, their garage and
lock responses return the previous values of supplied fields. Values are
normalized to their documented numeric or boolean types.

Set platform `webhook_response_mode` to `applied` if your client should receive
the resulting state instead. The optional JSON state API always returns applied
state. Other accessory types keep their existing response formats.

### State storage and downgrading

Garage and lock accessories import existing cached state automatically on first
use, then save state snapshots to `<resolved cache_directory>.plus-state-v1/`.
The original cache entries are retained but are no longer updated for these two
accessory types. Other accessory types keep their existing storage.

An older plugin can therefore read outdated garage or lock values after a
downgrade. Use your backup and arrange fresh state reports before relying on
those values. Do not clear Homebridge pairing or accessory caches as a state
storage repair. See [persistence details](STATE_API.md#persistence-and-errors).

### Logging and Home display

Platform and accessory `log_level` settings control verbosity. Credentials are
redacted, and HTTP request/response bodies are not logged. Debug messages also
require Homebridge's effective debug logging setting.

When optional feedback expiry is enabled, HomeKit reads become unavailable until
fresh feedback arrives. Apple Home can continue showing a cached value until it
refreshes; an already-open screen may not update immediately. HTTP command success
and cached state are not confirmation of physical movement.
