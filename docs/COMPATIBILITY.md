# Compatibility for 0.5.0

All accessory command paths now use Node's maintained HTTP/HTTPS transport.
`request` and unused `http-auth` dependencies are removed. No automatic retries.
Default deadline remains 10 seconds; response limit defaults 64 KiB. Redirects
are now disabled for every family; opt into `max_redirects` (1–5) for same-origin
redirects only. Cross-origin redirects and changed URL credentials are rejected.
301/302 POST and 303 responses switch to GET; 307/308 preserve method/body.
TLS verification remains on unless `rejectUnauthorized: false` is configured.

Raw strings and flat JSON form objects with string/number/boolean values are
supported. Malformed configuration, nested/array form values, conflicting raw
body/form, incomplete TLS file pairs and invalid limits fail early with fixed
error codes. Legacy families continue sending payloads only for POST/PUT/PATCH.
URL user-info Basic authentication and explicit Authorization headers remain
supported. Legacy placeholder substitutions remain unchanged.

Logging is configurable at platform and accessory level, with mandatory redaction
and no HTTP payload dumps. Existing state transitions are concise; routine reads
use debug. Debug cannot bypass Homebridge's own effective debug setting.
Other families' state semantics are unchanged; garage/lock state features are
not implicitly enabled for other accessory types. All aliases and identities
remain unchanged. UI arrays retain one bound item per configured accessory.

Home can retain its previous display until it refreshes, even after the API and
HAP reads report expired feedback. Reopening Home may be needed to observe
unavailability; recovery can also take time. API expiry is not a promise of an
immediate change on an already-open Home screen.

# Compatibility for 0.3.0

The garage/lock native [state API](STATE_API.md) is opt-in. Optimistic mode and
legacy previous-value responses remain defaults. State/cache correctness fixes,
strict validation, duplicate-ID rejection and rejection of incomplete Basic
authentication are unconditional. Node 18+ is required. Garage/lock command
requests now have finite response limits and do not follow redirects.

Names, IDs, aliases, service types, characteristic UUIDs and existing Homebridge
pairing/storage remain unchanged. The two state families import their legacy
keys into atomic snapshots in a sibling cache directory; back up both as described
in the API document. Review the deliberate downgrade implications there.
Other accessory-family runtime files remain byte-identical to upstream 0.2.0.
A source/package test cannot prove a particular Home's rooms or automations.

# Migrating to HTTP Webhooks Plus 0.2.1

This release republishes the upstream 0.2.0 implementation under the independent
package name `homebridge-http-webhooks-plus`. All `src/` files, the configuration
schema, runtime dependencies and declared runtime requirements are unchanged.
The package name passed to Homebridge registration is updated; the platform and
accessory aliases are preserved. No new state modes or feedback API ship in 0.2.1.

## Existing HomeKit accessories

Keep the existing `"platform": "HttpWebHooks"` configuration and every configured
accessory ID and name. Preserve the existing main/child bridge username, pairing,
port, persistent storage, service types and accessory configuration. Do not remove
the bridge or accessories in Apple Home, recreate the platform, clear cached
accessories or reset pairing as part of this package replacement.

Homebridge's static-platform UUID construction uses the configured platform
identifier and the accessory UUID base/name. With the existing unqualified
`HttpWebHooks` identifier and unchanged configuration, this release preserves
those inputs and the complete accessory implementation. Package-registration
tests and exact upstream runtime fingerprints protect this release boundary.
The owner's actual HomeKit rooms, scenes and automations still need checking
after a backed-up migration; source checks cannot verify a particular Home.

A package-qualified identifier such as
`homebridge-http-webhooks.HttpWebHooks` needs a separately reviewed migration:
changing its prefix can change the UUID seed. The same caution applies to
package-qualified standalone accessory identifiers. Do not blindly replace
every occurrence of the old package name in configuration or persistent data.

## Package replacement

1. Record the installed version and location, Node/Homebridge versions and any
   locally modified source files. Make a private backup of the package, full
   Homebridge configuration, persistent storage and pairing data.
2. Stop integrations that issue commands or publish state, then stop Homebridge
   using the service manager appropriate to your installation.
3. Replace the old package with the pinned Plus version in the same Homebridge
   plugin installation location. Do not load both packages together: their
   platform and accessory aliases intentionally overlap.
4. If top-level plugin allowlists or disabled-plugin lists are used, migrate
   the package entry deliberately. Retain the platform/accessory configuration
   and bridge identity. Check external tools for saved package paths or integrity
   receipts before restarting them.
5. Start Homebridge, verify the loaded package, and check that all existing
   accessories remain in the same rooms and automations. Then resume dependent
   integrations after their read-only readiness checks pass.

Installation directories vary between system packages, containers, global npm
and development setups. Use the existing Homebridge installation method; a
global npm command in an unrelated Node installation can affect the wrong copy.

## Locally patched installations

The public npm artifact contains generic upstream behavior. A locally patched
installation needs its patches preserved separately during this first migration.
Compare the exact original files and patched files, retain the installed hashes
and backups, and adapt any deployment receipts or saved paths. Do not assume
ordinary reinstalling retains changes made inside `node_modules`.

The package has no dependency on any particular controller or deployment script.
Future configurable features will allow integrations to stop patching installed
source. Integration-specific migration logic belongs to those integrations.

## State behavior retained from upstream

`targetdoorstate` represents the requested final door state; `currentdoorstate`
represents the reported state. Setting either through a webhook is a state update.
An existing HomeKit command handler can also optimistically publish final state
when its outgoing HTTP command succeeds. This first release preserves that
behavior, including existing limitations; HTTP acceptance does not prove physical
completion. Garage obstruction reporting is a separate characteristic and is
not a lock feature. See the README for the existing webhook fields.
