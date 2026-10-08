## 0.7.1

- Add Generate token beside the global Webhook Bearer token field. Use the
  browser’s cryptographic random generator for a 256-bit, 64-character hex
  token. Generation only stages the value; Save settings is still required.
- Preserve existing tokens on load and keep generated tokens masked. If secure
  random generation is unavailable, require manual entry without a weak fallback.

## 0.7.0

- Add opt-in external action execution for every controllable accessory family.
  Use `action=on` with one supported state/target/value query parameter to run
  the existing HomeKit SET handler. Omitted `action` or `action=off` preserves
  state-report behavior. Incoming authentication remains unchanged.
- Add optional global Bearer authentication for incoming reports and actions,
  with per-device opt-out. Basic authentication remains available as an alternative.
- Add Run action examples, accepted values and explicit execution in API calls.
  Sensor, stateless-button and doorbell reports remain events/state only.
- Validate commands before changing state; reject unsupported fields, disabled
  controls, ambiguous requests, missing URLs and invalid values. No retries.
- Reduce the API reference Field column to about ten characters, wrapping long
  names without hiding them.

## 0.6.3

- Default API example addresses to the Homebridge instance's detected IP or
  configured listener address instead of homebridge.local.
- Add Send state report / Send event and Read status buttons with HTTP status
  and response output below. Requests use the saved platform's credentials,
  remain local to this instance, and are never sent automatically or retried.
- Add the Homebridge plugin UI server helper dependency for authenticated
  server-side testing without browser CORS or mixed-content restrictions.

## 0.6.2

- Give the API reference Field column more room and keep field names on one
  line. Narrow screens can scroll the table without overflowing the page.

## 0.6.1

- Add an API calls page beside every configured device. Show device-specific
  fields, accepted values, authentication requirements, and copyable URLs and
  curl examples. Garage and lock references also offer JSON updates and status.
- Build examples using the device ID, webhook port, HTTPS setting, enabled fan
  controls, and configured button names/events. Credentials remain placeholders.
  Reference inputs do not save configuration or send requests to devices.
- Document fan power and physical-control parameter requirements in examples
  while preserving existing accessory behavior.

## 0.6.0

- Replace the flattened 0.5.1 settings form with a custom Homebridge configuration
  UI inspired by Roborock Matter: cards, teal accents, responsive fields, and
  Homebridge light/dark theme support.
- Manage all 15 accessory families with explicit Add, Edit, and Remove actions.
  Group each device’s commands, state feedback, notifications, and advanced
  settings. Nested stateless switch buttons are added only on request.
- Preserve untouched values, unknown options, numeric IDs, legacy state aliases,
  all configuration blocks, and child-bridge identity. Opening settings does not
  change configuration; Apply device stages edits and Save settings persists them.
- Validate IDs, listener settings, state API credentials, request payloads, and
  limits before saving. Keep edits available after a failed save.
- Retain the 0.5.1 startup protection against default-only accessory rows and
  allow an unused State API token to remain configured.
- Add browser coverage for saving, deletion, empty lists, all device types,
  responsive layout, and Homebridge theme changes. No new runtime dependencies.

## 0.5.1

- Stop the settings form from creating default-only accessories in unused device
  lists. Use schema-generated Add templates, allow zero devices in every family,
  and require an ID for devices deliberately added in the form.
- Ignore previously saved default-only rows during startup, with a warning that
  identifies their configuration location. Preserve all configured devices and
  reject incomplete devices with meaningful settings instead of discarding them.
- Keep the state API token independent of the configured accessory lists.

- Rewrite the README, upgrade guide, state API reference, and settings help around installation, configuration, and upgrading from the original HTTP Webhooks plugin.
- Clarify cache backups, optional state settings, and current HTTP redirect and request-limit behavior.

## 0.5.0

- Shared bounded core HTTP/HTTPS transport across command accessory families;
  remove deprecated request and unused http-auth dependencies. No retries;
  configurable same-origin redirects, deadlines and aggregate response limits.
- Platform/accessory logging inheritance and mandatory redaction; remove raw
  request/response dumps, with additional custom redaction keys.
- Configurable inbound bounds, listener cleanup and early configuration errors;
  expose HTTP/logging/form controls in bound per-device UI items.
- Preserve legacy state semantics and identities; document Home display refresh
  limitations for feedback expiry and recovery.

## 0.4.0

- Add opt-in per-accessory current-state feedback expiry for garages and locks, with monotonic deadlines and communication-error recovery.
- Add independent garage obstruction monitoring and expiry; missing reports never imply clear.
- Commands, capability/status reads and invalid updates do not renew observation freshness. Both legacy webhooks and v1 reports support the new options.
- Stop freshness timers on shutdown/storage failure; retain cached diagnostic values without presenting stale state as available.
- Expose settings in the configuration UI and expand standalone README guidance. Defaults keep expiry disabled and obstruction monitoring off.

## 0.3.2

- Fix garage/lock settings layout: bind all per-device fields and collapsible groups to one array-item template so existing configured accessories appear together.
- Remove the duplicate Webhook Settings heading and its unnecessary array wrapper.

## 0.3.1

- Expose garage/lock state, startup, notification and HTTP bounds in the explicit Homebridge settings form, grouped per accessory.
- Expose shared state API authentication and legacy response mode in platform settings, with scope and default explanations.
- Runtime behavior and dependencies are unchanged from 0.3.0.

## 0.3.0

- Add generic garage/lock optimistic/external modes and garage external_state alias.
- Add authenticated v1 applied-state/status API, explicit notification outcomes and duplicate-event limits.
- Validate entire updates, including zero/false and mixed obstruction changes; preserve legacy responses by default.
- Persist coherent atomic snapshots, import existing keys, guard late command completions and offer explicit startup policy.
- Bound and redact new command/API handling, reject duplicate IDs and incomplete Basic auth; retain other accessory families.
- Require Node 18+; preserve aliases, IDs, names and HAP service/characteristic identities.

# 0.2.1 — HTTP Webhooks Plus

- Publish the independent fork as `homebridge-http-webhooks-plus`.
- Update package registration and repository links while retaining every existing platform/accessory alias.
- Preserve upstream 0.2.0 runtime source, configuration schema, dependencies and state behavior.
- Add compatibility checks, package CI and an upgrade guide.

### 0.2.0
- Added Homebridge v2 compytability (thanks to jsiegenthaler).
- Added Doorbell (thanks to jsiegenthaler).

### 0.2.0-beta.1
From jsiegenthaler:
Updated package.json to show compatibility with Homebridge v2
Tested on Homebridge v2 with a motion sensor, all OK

Fixed tick-mark typo in Readme for Occupancy sensor
Fixed typo and capitalisation issues in Readme for Window Covering

Fixed issue  "This plugin generated a warning from the characteristic 'Current Ambient Light Level'" when state is unknown in HttpWebHookSensorAccessory.js
Improved logging for sensors to include sensor type to help in debugging in HttpWebHookSensorAccessory.js

Fixed log level inconsistencies in HttpWebHookGarageDoorOpenerAccessory.js 
Fixed logging error in getCurrentHeatingCoolingState
Fixed capitalisation consistency errors in HttpWebHookThermostatAccessory.js

Updated Readme:
  Updated name of all sensors to show sensor type (Motion Sensor name 2 etc) to make it easier to test
  Updated name of Push Button to make name consistent with other examples
  Updated name of Security System to make name consistent with other examples
  Updated name of Window Covering to make name consistent with other examples
  Updated id, name, open_url and close_url of example Lock Mechanism in Readme to make name consistent with other examples
  Updated id and name of example Fanv2 to make name Homebridge v2 compliant
  Updated name of CO2 Sensor to make name consistent with other examples

Updated dependencies:
  "http-auth": "^4.2.0",
  "node-persist": "^2.1.0",
  "request": "^2.88.2",
  "selfsigned": "^2.4.1"
NOTE: a newer version of node-persist exists but all storage commands are async, requiring more code changes

### 0.1.19

New features:
  - Added accessory names to log entries (thanks to jsiegenthaler).

### 0.1.18

Bugfix:
  - fixed "nan" log when using fanv2 (thanks to shirnschall).


### 0.1.17

Breaking change:
  - Thermostat parameter was wrong. Documentation stated "maxTemp" but was "maxValue". Now changed "maxValue" to "maxTemp" according to documentation (thanks to mgoeppl)

### 0.1.16

New features:
  - Added value support (thanks to emptygalaxy)

### 0.1.15

New features:
  - Support minValue, maxValue and minStep for thermostats (thanks to NikDevx)

### 0.1.14

New features:
  - Support http method PATCH (thanks to supermamon)

### 0.1.13

New features:

  - Added CO2 sensor (thanks to jwktje)

### 0.1.12

New features:

  - Added Fanv2 (thanks to p-x9)

### 0.1.11

Bugfix:

  - Reduced some more log messages by using debug (thanks to jsiegenthaler).

### 0.1.10

New features:

  - You can now set "rejectUnauthorized" to false on each accessory to allow calls via https on using unsecure certificate.

Bugfix:

  - Reduced some log messages by using debug (thanks to jsiegenthaler).

### 0.1.9

Bugfix:

  - Sensors now return cached value if state and value is not provided in URL (thanks to tritter).

### 0.1.8

Bugfix:

  - Stateless switch web hook did not return a response.


### 0.1.7

Bugfix:

  - Missed to add "webhook_enable_cors" and "auto_set_current_position" to config.schema.json for Config UI X.

### 0.1.6

New features:

  - You can now set "webhook_enable_cors" to true to enable cors for webhook server (thanks to konstantinkobs).

### 0.1.5

New features:

  - You can now set "auto_set_current_position" in for window coverings to true if you dont use callbacks to let your covering give feedback of current position back to homekit.

### 0.1.4

Bugfix:

  - Fixed bug as pushbutton does not have a cached state.

### 0.1.3

Bugfix:

  - Fixed bug if no url is called and no success callback is set.

### 0.1.2

New features:

  - Support Config UI X (thanks to donavanbecker).

### 0.1.1

New features:

  - You can now query the state of security system by avoiding currentstate and targetstate parameter.

Bugfix:

  - Fixed bug that success callback is not called if no url is called.
  - Fixed bug, that security system shows correct status after restart.

### 0.1.0

Major restructuring for better maintainance. I tried best to not break anything. If I did, please report issue and I will fix it.

New features:

  - "on_form"/"off_form" now supported for outlets

### 0.0.62

New features:

  - You can now change the host to listen to. Default is "0.0.0.0". For ipv6 you can use "::".

### 0.0.61

Bugfix:

  - Now all http status codes >= 200 && < 300 are treated as success.

### 0.0.60

New features:

  - Added brightness to light.

### 0.0.59

New features:

  - Added Leak Sensor (thanks to RamSet)

### 0.0.58

New features:

  - Set Manufacturer, Model and SerialNumber to address issue with Eve App v4.2+ (https://github.com/homebridge/homebridge/issues/2503)

### 0.0.57

New features:

  - Added subjectAltName to generated SSL cert.
  - Support SSL certificate update if code changes by using a version number.
  - Support own SSL certificates using properties httpsKeyFile and httpsCertFile.

### 0.0.56

Bugfix:

  - Webhooks didn't work anymore. Please update.

### 0.0.55

New features:

  - You can now secure the webhook server using a self signed ssl certificate (beta state).

### 0.0.54

Bugfix:

  - Added ReadMe about cache directory.

### 0.0.52

New features:

  - Added auto release for contact sensor. Added auto release time to contact, motion, and occupancy sensor.

### 0.0.51

Bugfix:

  - Return valid Json in webhook (thanks to mshulman)

### 0.0.50

New features:

  - You can now set body, form and custom headers for switches, pushbuttons, lights, thermostats, garage door openers, window coverings, lock mechanism & security system. (by EddyK69)

### 0.0.49

New features:

  - You can now set custom headers for switches.
  - You can now set body and custom headers for outlets.

### 0.0.48

Bugfix:

  - Fixed security system spinning wheel in homekit after action.

### 0.0.47

Bugfix:

  - Fixed garage door spinning wheel visiable in homekit after action.

### 0.0.46

New features:

  - Added window coverings. (thanks to kaowiec)

### 0.0.45

Bugfix:

  - Fixed lock mechanism.

### 0.0.44

Bugfix:

  - Now a temperature sensor can handle negative values.

### 0.0.43

New features:

  - Added light sensor. (thanks to gorootde)

Bugfix:

  - Fixed auto release for motion and occupancy sensor. (thanks to kovalev-sergey)

### 0.0.42

New features:

  - Updated dependency to request.

### 0.0.41

New features:

  - Added lock mechanism. (thanks to kaowiec).

### 0.0.40

New features:

  - Added stateless switches. (thanks to BetoRn).
  - Added request body support for POST and PUT request for switches. (thanks to BetoRn).
  - Added auto release for motion and occupancy sensor. (thanks to BetoRn).

### 0.0.39

New features:

  - Added Garage Door Opener accessory. (thanks to FlyingLemming).

### 0.0.38

New features:

  - Added a new accessory to support security system. (thanks to jcbriones).

## 0.0.37

Bugfix:

  - Listen to Ipv4.

### 0.0.36

New features:

  - Added air quality as sensor (thanks to tansuka).

### 0.0.35

New features:

  - Added http authentication if desired (thanks to paolotremadio).

### 0.0.34

Bugfix:

  - Last fix wasn't correct. Removed cache handling for push button as state is always false.

### 0.0.33

Bugfix:

  - Fix issue where push button doesn't change its cache state back to false.

### 0.0.32

New features:

  - Added support for outlet.

### 0.0.31

New features:

  - Added support for temperature, humidity and thermostats (thanks to iEns).

### 0.0.30

New features:

  - Support setting the request method. Only GET and PUT are tested. Default is still GET.

# 0.0.29

Bugfix:

  - Use correct type to update smoke sensor state via webhook.
  - Switch back pushbutton correctly using timeout if it was updated to state = true via webhook.

## 0.0.28

Bugfix:

  - Now uses updateValue instead of setValue to update iOS correctly.

## 0.0.27

New features:

  - Webhooks no longer call the on/off/push url as in most cases the webhook gets called from an external smart home system that already knows the new state as it send the webhook call.

## 0.0.26

New features:

  - Added light. Currently just on/off is supported.

## 0.0.25

Bugfix:

  - Now Uses the Characteristic's Enumeration for Value Reporting.
  - Now a webhook call only triggers homekit change if the state is not the same as in the cache. This fixed an issue where a homekit change was triggered twice, once by homekit and once by the resulting webhook call of an external system that also reacts on changes.

## 0.0.24

Bugfix:

  - Push buttons without url do now switch state back correctly.

## 0.0.23

New features:

  - Added push buttons. The button will be released automatically.

## 0.0.22

Bugfix:

  - Switches without on or off url do now switch state correctly.

## 0.0.21

New features:

  - You can now call the webhook URL without the state parameter to get the current state of the accessory.

## 0.0.20

New features:

  - Added occupancy sensor (thanks to wr).

## 0.0.19

Bugfix:

  - Removed some logging.

## 0.0.18

Bugfix:

  - Added context to setValue call.

## 0.0.17

Bugfix:

  - Fixed infinite loop for switches.

## 0.0.16

Bugfix:

  - Fixed switches one more time.

## 0.0.15

Bugfix:

  - Fixed switches.

## 0.0.14

New features:

  - Added switch.

## 0.0.13

New features:

  - Added smoke sensor.

## 0.0.12

Bugfix:

  - Fixed readme.

## 0.0.11

Bugfix:

  - Fixed state values.

## 0.0.10

Bugfix:

  - Fixed context.

## 0.0.9

Bugfix:

  - Fixed variable.

## 0.0.8

Bugfix:

  - Implemented getState.

## 0.0.7

Bugfix:

  - Added missing dot.

## 0.0.6

New features:

  - Added some logging.

## 0.0.5

Bugfix:

  - Fix another copy and paste error.

## 0.0.4

Bugfix:

  - Fix copy and paste error.

## 0.0.3

Bugfix:

  - Fix context.

## 0.0.2

Bugfix:

  - Removed unexpected ';'.

## 0.0.1

Initial release version.

