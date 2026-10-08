# homebridge-http-webhooks-plus

Connect HTTP devices, services, and automations to Apple Home through
[Homebridge](https://github.com/homebridge/homebridge). Incoming webhooks update
accessory state; HomeKit actions can send HTTP requests to your configured URLs.

Supported accessories include sensors, switches, push buttons, doorbells, lights
(on/off and brightness), outlets, thermostats, security systems, garage doors,
locks, window coverings, fans, and valves. Sensor types include contact, motion,
occupancy, smoke, temperature, humidity, air quality, light level, CO2, and leaks.

**Upgrading from the original plugin?** Follow the [upgrade guide](docs/COMPATIBILITY.md)
to keep your existing configuration and HomeKit accessories. New garage and lock
state features are optional. See the [changelog](CHANGELOG.md) for release details.

The original GPL-3.0 license and attribution are retained. Node.js 18 or newer is required.

## What does HTTP Webhooks Plus add?

HTTP Webhooks Plus creates virtual HomeKit accessories whose state can be updated
by webhooks and whose actions can call your configured URLs. It builds on the
[original plugin](https://github.com/benzman81/homebridge-http-webhooks) with more
control over state reporting, HTTP requests, and logging.

Here's what changes compared with `homebridge-http-webhooks` 0.2.0:

| Situation | Original plugin | HTTP Webhooks Plus |
| --- | --- | --- |
| **A garage or lock command succeeds** | Updates HomeKit to the requested state after HTTP success. | Adds optional **external state mode**, which waits for your integration to report the current state. Useful when accepting a command and completing the operation happen at different times. |
| **Homebridge restarts** | Uses cached state, or defaults to closed/secured if none exists. | Lets each garage or lock wait for a new report before making its current state available. |
| **An integration stops reporting** | Keeps returning the stored state without an expiry policy. | Can mark garage or lock feedback unavailable after a configurable timeout. Useful for integrations that send regular reports. |
| **A command response arrives after newer feedback** | Its completion handler can overwrite the newer reported state. | Guards against outdated command completions replacing newer state. |
| **The same state needs to be announced again** | Has no explicit option to resend unchanged garage or lock state as a HomeKit event. | Can send an explicitly requested event for an unchanged value, with limits on repeated events. |
| **Garage obstruction feedback stops** | Keeps using the stored obstruction value. | Can require obstruction reports and expire them independently of door-position reports. |
| **An HTTP endpoint responds slowly or sends excessive data** | Uses built-in request timeouts. | Adds configurable deadlines covering the complete command response, response-size limits, and controls for following redirects. |
| **You need quieter or more useful logs** | Some request paths log URLs and request or response bodies. | Adds plugin and accessory log controls, credential redaction, and removes raw request/response dumps. |

The garage and lock state options work through the **existing webhook URLs**.
External state mode, feedback expiry, obstruction monitoring, and explicit repeat
events are optional. Other accessory types retain their existing state behavior
while benefiting from the applicable HTTP and logging improvements.

An optional, token-protected **JSON State API** provides a consistent interface
for reading garage and lock status, inspecting settings, and submitting updates.
Existing webhook clients can also request richer update responses through the
`applied` response setting.

Your integration remains responsible for reporting accurate state and controlling
the hardware. The plugin presents those reports to HomeKit and forwards configured
actions.

## Configuration UI

Open the plugin’s **Settings** in Homebridge UI. The custom interface uses the
same plain HTML, JavaScript, CSS, and Homebridge configuration API approach as
[Roborock Matter](https://github.com/mathiashornbek/homebridge-roborock-matter),
with cards, teal accents, grouped fields, and Homebridge light/dark themes.

- **Devices:** view configured accessories, add one of the 15 device types, edit
  its grouped settings, or confirm removal. No devices are created merely by
  opening or saving the page.
- **API calls:** beside each device, open a reference with supported fields,
  value meanings, and copyable URLs and curl examples. Change the hostname and
  example values without changing settings. The address defaults to this
  Homebridge instance's IP. **Send state report** (or **Send event**) and **Run action** send the
  displayed request and shows its HTTP status and response below; requests only
  run when clicked. Tests use saved credentials and this instance's saved
  listener, including local self-signed HTTPS. Save and restart before testing
  changed settings. Garage and lock
  pages also show JSON updates and status calls. Authentication credentials are
  placeholders; replace them in your external program. Examples reflect current
  configuration values, so save and restart before using changed settings.
- **Webhook settings:** configure the listener, optional incoming State API,
  authentication, HTTPS, logging, and request limits.
- **Save settings:** device edits are staged with **Apply changes**; this saves
  all staged changes. Restart the child bridge afterward. The page retains
  untouched options and child-bridge metadata and reports failed saves without
  discarding your edits.

The State API token is optional and independent of the device list. A valid
unused token can stay configured after removing all garages and locks.

## Garage and lock state controls

These features are per accessory: each garage or lock can have its own state,
startup and notification policies. They work through both the original webhook
URLs and the optional v1 JSON API. Configure them separately for each garage or
lock; other accessory types keep their existing state behavior.

In the plugin’s Homebridge Settings, find the garage or lock under **Devices**
and choose **Edit**. Open its **State and feedback**, **Notifications**, or
**Obstruction feedback** settings. Apply your device changes, then save settings.

| Option | Default | Meaning |
| --- | --- | --- |
| `state_mode` | `optimistic` | Assume completion after HTTP command success, or choose `external` to wait for a reported current state. HTTP acceptance is not physical position. |
| `startup_state_policy` | `use_cache` for optimistic; `await_feedback` for external | Use unverified cached/default state, or wait for new reports. The Automatic UI selection omits the option so the contextual default applies. |
| `notification_policy` | `changes_only` | `allow_explicit` also lets clients reaffirm unchanged values, without repeating commands. |
| `notification_min_interval_ms` | `1000` | Limit repeated identical explicit events, 100–60000 ms. Ordinary changes still propagate. |
| `request_timeout_ms` | `10000` | Bound each outgoing garage/lock command, including response reading. |
| `response_max_bytes` | `65536` | Bound the outgoing command's response body. |
| `feedback_timeout_seconds` | `0` | Disable expiry, or expire current-state feedback after this many seconds. |
| `obstruction_monitoring` (garage) | `false` | Require independent obstruction reports; start unavailable until one arrives. |
| `obstruction_timeout_seconds` (garage) | `0` | With monitoring enabled, optionally expire obstruction feedback independently. |

Use optimistic mode for intentional virtual devices. Use external mode when a
sensor or integration reports state. Garage entries also accept `external_state`
as a boolean alternative: `true` selects external mode and `false` selects
optimistic mode. If also specifying `state_mode`, both must agree.

### Using the original webhook URLs

No State API token is needed for these routes. Existing Basic authentication, if
configured, still applies. For a garage with ID `sample-garage`, report closed:

```text
http://HOST:PORT/?accessoryId=sample-garage&currentdoorstate=1&targetdoorstate=1
```

With `notification_policy: "allow_explicit"`, append `&force_notify=true` to
request another event even if the values have not changed. To report a lock,
use `lockcurrentstate` and `locktargetstate`. For garage obstruction, use
`obstructiondetected=true` or `false`; zero and false are valid updates.
Current and target can differ. State reports never invoke the outgoing command URLs. External commands require `action=on` and explicit per-device enablement (see below).

### Optional JSON state API

Set **Webhook Settings → Incoming state API → Token** to enable v1 routes.
This shared credential grants access to all supported garages/locks on that
platform. The accessory ID in the URL selects the device; this is not per-device
access control. Multiple clients can share this server. Send `X-Webhooks-Token`
and any configured Basic authentication. This token is never automatically sent
to the per-action outgoing command URLs.

`GET /v1/accessories/sample-garage` reads capabilities and status.
`POST /v1/accessories/sample-garage/state` accepts JSON such as:

```json
{"currentState": 1, "targetState": 1, "notify": true}
```

The v1 response always describes applied state and notification outcomes.
**Compatibility → Legacy webhook response format** defaults to `legacy` and
controls only original garage/lock routes. Choose `applied` there if a legacy
client needs the richer response; it does not enable or disable state features.
An event acknowledgement is not proof of delivery to a particular phone.

### Missing and stale feedback

Choose a timeout longer than the integration's report interval plus expected
network delays. Valid current-state reports, even unchanged ones, renew only
current-state freshness. Target commands, HTTP success, GETs and invalid reports
do not. Obstruction requires its own reports; a door heartbeat is not evidence
that an old obstruction flag remains current.

Unavailable reads return HomeKit communication errors. Home may show Updating
or No Response; garages have no Unknown enum, and Stopped is not a substitute
for unavailable position. Stored values are retained for diagnostics but are
not available readings. Fresh valid reports restore availability without motor
commands. `use_cache` gives unverified cached/default current state a startup
grace interval when a timeout is enabled; persisted timestamps never establish
freshness after restart. Monitored obstruction always awaits its own first report.

See [State API details](docs/STATE_API.md) for values, bounds, errors and storage,
and [compatibility](docs/COMPATIBILITY.md) before upgrading or downgrading.

# Installation
1. Install and set up [Homebridge](https://github.com/homebridge/homebridge).
2. Search for **homebridge-http-webhooks-plus** in Homebridge UI and install it.
   For an installation managed with global npm, use `npm install -g homebridge-http-webhooks-plus` in the same Node.js environment as Homebridge.
3. Configure the plugin in Homebridge UI, or use the configuration example below.
   Restart Homebridge to load your accessories.

If you already use `homebridge-http-webhooks`, follow the [upgrade guide](docs/COMPATIBILITY.md)
before installing Plus. The two packages use the same accessory aliases and must
not run together.

# Retrieve State
To retrieve the current state, you need to call the url `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToTrigger`
The returned JSON format is:
```
    {
        "success": true,
        "state": cachedState
    }
```

# Trigger Change for Boolean Accessory
To trigger a change of a boolean accessory you need to call the url `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToTrigger&state=NEWSTATE`
Use only the text `true` or `false`. Do not use numbers 1 or 0.

## Contact Sensor
For contact sensors the value for `NEWSTATE` is either `true` for contact or `false` for no contact. If `autoRelease` is used, then the state will be released after `autoReleaseTime`, if not set 5 seconds.

## Motion Sensor
For motion sensors the value for `NEWSTATE` is either `true` for motion detection or `false` for no motion. If `autoRelease` is used, then the state will be released `autoReleaseTime`, if not set 5 seconds.

## Occupancy sensor
For occupancy sensors the value for `NEWSTATE` is either `true` for occupancy detection or `false` for no occupancy. If `autoRelease` is used, than the state will be released `autoReleaseTime`, if not set 5 seconds.

## Smoke Sensor
For smoke sensors the value for `NEWSTATE` is either `true` for smoke detection or `false` for no smoke.

## Switch
For switches the value for `NEWSTATE` is either `true` for on or `false` for off.

## Push Button
For push buttons the value for `NEWSTATE` is `true`. The button will be released automatically.

## Light
For lights the value for `NEWSTATE` is either `true` for on or `false` for off.

## Outlet
For outlets the value for `NEWSTATE` is either `true` for on or `false` for off.

### Outlet In Use
For outlets the additional state `stateOutletInUse` is available. The value for `NEWSTATE` is either `true` for on or `false` for off and
can be changed by calling the url `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToTrigger&stateOutletInUse=NEWSTATE`

## Fanv2
For fanv2 the value for `NEWSTATE` is either `true` for on or `false` for off.

## Valve
For valves/faucets the value for `NEWSTATE` is either `true` for on or `false` for off.

### Valve Fault State
For valves the additional state `statusFault` is available. The value for `NEWSTATE` is either `true` for on or `false` for off and
can be changed by calling the url `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToTrigger&statusFault=NEWSTATE`

# Trigger Action

## Switch
For switches you can call the url from any system to switch the switch on or off.

## Push Button
For push buttons you can call the url from any system to push the button. The button will be released automatically.

## Doorbell
Doorbells require 2 parameters: accessoryId and the event to trigger:
* Single press = 0
* Double press = 1
* Long press = 2
`http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&event=EVENT`

Examples:
* Ring the doorbell with a single button press: `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&event=0`
* Ring the doorbell with a long button press: `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&event=2`

Doorbells are shown as a stateless programmable switch.
When the doorbell is rung by calling the webhooks url, it generates the notification "Roomname doorbell rang." and executes any actions which have been added in the Home app to the stateless programmable switch.
When adding the doorbell to the Home app, it will ask for somme options to recognise familiar faces. These can be ignored, as no camera is associated with the doorbell.

## Light
For lights you can call the url from any system to switch the light on or off.

## Outlet
For outlets you can call the url from any system to switch the outlet on or off.

## Fanv2
For fanv2 you can call the url from any system to switch the fanv2 on or off.

# Update a Numeric Accessory
To update a numeric accessory, you need to call the url `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&value=NEWVALUE`

## Temperature Sensor
For temperature sensors the value for `NEWVALUE` is the new temperature reading.

## Light Sensor
For light sensors the value for `NEWVALUE` is the new light intensity in lux (as float).

## Humidity Sensor
For humidity sensors the value for `NEWVALUE` is the new relative humidity percentage reading.

## Air Quality Sensor
For air quality sensors the value for `NEWVALUE` is the new air quality value (Between 1-5, 1 Excellent).

## CO2 Sensor
For a CO2 sensor the value for `NEWVALUE` is the new PPM reading.

## Leak Sensor
For leak sensors the value for `NEWVALUE` is the new leak state value (1 for leak, 0 for dry).

## Light (brightness)
For light brightness the value for `NEWVALUE` is the new light brightness (as integer, between 0 and 100 with respect to brightness factor).

# Thermostat
To update a thermostat, you can update four different values:
* Current temperature reading: `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&currenttemperature=NEWVALUE`
* Target temperature: `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&targettemperature=NEWVALUE`
* Current state (Off=0 / Heating=1 / Cooling=2): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&currentstate=NEWVALUE`
* Target state (Off=0 / Heat=1 / Cool=2 / Auto=3): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&targetstate=NEWVALUE`

# Security System
To update the state of security, you can update two different values:
* Current state (Stay=0 / Away=1 / Night=2 / Disarmed=3 / Triggered=4): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&currentstate=NEWVALUE`
* Target state (Stay=0 / Away=1 / Night=2 / Disarm=3): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&targetstate=NEWVALUE`

# Garage Door Opener
To update a garage door opener, you can update three different values:
* Current door state (Open=0 / Closed=1 / Opening=2 / Closing=3 / Stopped=4): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&currentdoorstate=NEWVALUE`
* Target door state (Open=0 / Closed=1): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&targetdoorstate=NEWVALUE`
* Obstruction detected (No=0 / Yes=1): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&obstructiondetected=NEWVALUE`

# Stateless Switch
Stateless switches requires 3 parameters: accessoryId, buttonName and the event to trigger:
* Single press = 0
* Double press = 1
* Long press = 2

`http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&buttonName=theButtonName&event=EVENT`

# Lock Mechanism
To update a lock mechanism, you can update two different values:

* Current lock state (unsecured=0 / secured=1 / jammed=2 / unknown=3): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&lockcurrentstate=NEWVALUE`
* Target lock state (unsecured=0 / secured=1): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&locktargetstate=NEWVALUE`

# Window Covering
To update a window covering you can update three different values:
* Current Position (%): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&currentposition=%s` (%s is replaced by corresponding current position)
* Target Position (%): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&targetposition=%s` (%s is replaced by corresponding target position)
Setting of target position you can realize by send link to: open, 20%, 40%, 60% 80% and close
* Position State (Decreasing=0 / Increasing=1 / Stopped=2): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&positionstate=0 (1 or 2)` (position state is not mandatory and not fully tested yet)

If you don't use callbacks to let your covering give feedback of current position back to HomeKit you can set "auto_set_current_position" to true.

# Fanv2
To update a fanv2 you can update five different values:
* Rotation Speed (%): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&speed=%s` (%s is replaced by fan's rotation speed)
* Swing Mode (DISABLED=0 / ENABLED=1): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&swingMode=0 (or 1)` (To use this feature, "enableSwingModeControls" in config must be set to true.)
* Rotation Direction (CLOCKWISE=0 / COUNTER_CLOCKWISE=1): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&rotationDirection=0 (or 1)`
* Lock Physical Controls (DISABLED=0 / ENABLED=1): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&lockstate=0 (or 1)` (To use this feature, "enableLockPhysicalControls" in config must be set to true.)
* Target Fan State (MANUAL=0 / AUTO=1): `http://yourHomebridgeServerIp:webhook_port/?accessoryId=theAccessoryIdToUpdate&targetState=0 (or 1)`(To use this feature, "enableTargetStateControls" in config must be set to true.)

# Valve
For valves/faucets you can call the url from any system to switch the valve on or off.

# Configuration
Example config.json:
```
    {
        "platforms": [
            {
                "platform": "HttpWebHooks",
                "webhook_port": "51828",
                "webhook_listen_host": "::", // (optional, default: "0.0.0.0")
                "webhook_enable_cors": true, // (optional, default: false)
                "cache_directory": "./.node-persist/storage", // (optional, default: "./.node-persist/storage")
                "http_auth_user": "test", // (optional, only if you like to secure your api)
                "http_auth_pass": "test", // (optional, only if you like to secure your api)
                "https": true, // (beta state, optional, only if you like to secure your api using ssl certificate)
                "https_keyfile": "/pathToKeyFile/server.key", // (beta state, optional, only if you like to secure your api using ssl certificate)
                "https_certfile": "/pathToKeyFile/server.cert", // (beta state, optional, only if you like to secure your api using ssl certificate)
                "sensors": [
                    {
                        "id": "sensor1",
                        "name": "Contact Sensor name 1",
                        "type": "contact",
                        "autoRelease": false, // (optional)
                        "autoReleaseTime": 7500 // (optional, in ms)
                    },
                    {
                        "id": "sensor2",
                        "name": "Motion Sensor name 2",
                        "type": "motion",
                        "autoRelease": false, // (optional)
                        "autoReleaseTime": 7500 // (optional, in ms)
                    },
                    {
                        "id": "sensor3",
                        "name": "Occupancy Sensor name 3",
                        "type": "occupancy",
                        "autoRelease": false, // (optional)
                        "autoReleaseTime": 7500 // (optional, in ms)
                    },
                    {
                        "id": "sensor4",
                        "name": "Smoke Sensor name 4",
                        "type": "smoke"
                    },
                    {
                        "id": "sensor5",
                        "name": "Temperature Sensor name 5",
                        "type": "temperature"
                    },
                    {
                        "id": "sensor6",
                        "name": "Humidity Sensor name 6",
                        "type": "humidity"
                    },
                    {
                        "id": "sensor7",
                        "name": "Air Quality Sensor name 7",
                        "type": "airquality"
                    },
                    {
                        "id": "sensor8",
                        "name": "Light Sensor name 8",
                        "type": "light"
                    },
                    {
                        "id": "sensor9",
                        "name": "Leak Sensor name 9",
                        "type": "leak"
                    }
                ],
                "switches": [
                    {
                        "id": "switch1",
                        "name": "Switch name 1",
                        "rejectUnauthorized": false, // (optional)
                        "on_url": "your url to call when the switch is turned on", // (optional)
                        "on_method": "GET", // (optional)
                        "on_body": "{ \"on\" : true }", // (optional only for POST, PUT and PATCH; use "on_form" for x-www-form-urlencoded JSON)
                        "on_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "off_url": "your url to call when the switch is turned off", // (optional)
                        "off_method": "GET", // (optional)
                        "off_body": "{ \"on\": false }", // (optional only for POST, PUT and PATCH; use "off_form" for x-www-form-urlencoded JSON)
                        "off_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}" // (optional)
                    }
                ],
                "pushbuttons": [
                    {
                        "id": "pushbutton1",
                        "name": "Push Button name 1",
                        "rejectUnauthorized": false, // (optional)
                        "push_url": "your url to call when the pushbutton is pushed", // (optional)
                        "push_method": "GET", // (optional)
                        "push_body": "{ \"push\": true }", // (optional only for POST, PUT and PATCH; use "push_form" for x-www-form-urlencoded JSON)
                        "push_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}" // (optional)
                    }
                ],
                "doorbells": [
                    {
                        "id": "doorbell1",
                        "name": "Doorbell name 1",
                        "double_press": false, // (optional, set to true to enable this action if desired)
                        "long_press": false // (optional, set to true to enable this action if desired)
                    }
                ],
                "lights": [
                    {
                        "id": "light1",
                        "name": "Light name 1",
                        "rejectUnauthorized": false, // (optional)
                        "on_url": "your url to call when the light is turned on", // (optional)
                        "on_method": "GET", // (optional)
                        "on_body": "{ \"on\" : true }", // (optional only for POST, PUT and PATCH; use "on_form" for x-www-form-urlencoded JSON)
                        "on_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "off_url": "your url to call when the light is turned off", // (optional)
                        "off_method": "GET", // (optional)
                        "off_body": "{ \"on\": false }", // (optional only for POST, PUT and PATCH; use "off_form" for x-www-form-urlencoded JSON)
                        "off_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "brightness_url": "your url to call when the light brightness is changed", // (optional)
                        "brightness_method": "GET", // (optional)
                        "brightness_body": "{ \"on\" : %statusPlaceholder, \"bri\" : %brightnessPlaceholder}", // (optional only for POST, PUT and PATCH; use "brightness_form" for x-www-form-urlencoded JSON, variables are replaced on the fly)
                        "brightness_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "brightness_factor": 2.55 // (optional to convert homekit brightness to target system brightness)
                    }
                ],
                "thermostats": [
                    {
                        "id": "thermostat1",
                        "name": "Thermostat name 1",
                        "minTemp": 15, // (optional)
                        "maxTemp": 30, // (optional)
                        "minStep": 0.5, // (optional)
                        "rejectUnauthorized": false, // (optional)
                        "set_target_temperature_url": "http://127.0.0.1/thermostatscript.php?targettemperature=%f",        // %f is replaced by the target temperature
                        "set_target_temperature_method": "GET", // (optional)
                        "set_target_temperature_body": "{ \"on\" : true }", // (optional only for POST, PUT and PATCH; use "set_target_temperature_form" for x-www-form-urlencoded JSON)
                        "set_target_temperature_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "set_target_heating_cooling_state_url": "http://127.0.0.1/thermostatscript.php?targetstate=%b",     // %b is replaced by the target state
                        "set_target_heating_cooling_state_method": "GET", // (optional)
                        "set_target_heating_cooling_state_body": "{ \"on\" : true }", // (optional only for POST, PUT and PATCH; use "set_target_heating_cooling_state_form" for x-www-form-urlencoded JSON)
                        "set_target_heating_cooling_state_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}" // (optional)
                    }
                ],
                "co2sensors" : [
                    {
                        "id": "co2sensor1",
                        "name": "CO2 Sensor name 1",
                        "co2_peak_level": 1200
                    }
                ],
                "outlets": [
                    {
                        "id": "outlet1",
                        "name": "Outlet name 1",
                        "rejectUnauthorized": false, // (optional)
                        "on_url": "your url to call when the outlet is turned on", // (optional)
                        "on_method": "GET", // (optional)
                        "on_body": "{ \"on\" : true }", // (optional only for POST, PUT and PATCH; use "on_form" for x-www-form-urlencoded JSON)
                        "on_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "off_url": "your url to call when the outlet is turned off", // (optional)
                        "off_method": "GET", // (optional)
                        "off_body": "{ \"on\": false }", // (optional only for POST, PUT and PATCH; use "off_form" for x-www-form-urlencoded JSON)
                        "off_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}" // (optional)
                    }
                ],
                "security": [
                    {
                        "id": "security1",
                        "name": "Security System name 1",
                        "rejectUnauthorized": false, // (optional)
                        "set_state_url": "http://localhost/security/mode/%d", // %d is replaced by the target state
                        "set_state_method": "GET", // (optional)
                        "set_state_body": "{ \"on\": true }", // (optional only for POST, PUT and PATCH; use "set_state_form" for x-www-form-urlencoded JSON)
                        "set_state_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}" // (optional)
                    }
                ],
                "garagedooropeners": [
                    {
                        "id": "garagedooropener1",
                        "name": "Garage Door Opener name 1",
                        "rejectUnauthorized": false, // (optional)
                        "open_url" : "your url to call when the garage door is opened", // (optional)
                        "open_method" : "GET", // (optional)
                        "open_body": "{ \"open\": true }", // (optional only for POST, PUT and PATCH; use "open_form" for x-www-form-urlencoded JSON)
                        "open_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "close_url" : "your url to call when the garage door is closed", // (optional)
                        "close_method" : "GET", // (optional)
                        "close_body": "{ \"open\": false }", // (optional only for POST, PUT and PATCH; use "close_form" for x-www-form-urlencoded JSON)
                        "close_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}" // (optional)
                    }
                ],
                "statelessswitches": [
                    {
                    "id": "statelessswitch1",
                    "name": "Stateless Switch name 1",
                    "buttons": [//the buttons of the switch
                    "name": "Stateless Switch 1",
                    "buttons": [ //the buttons of the switch
                        {
                            "name": "Button1" // (The name does not appear in Home app but appear in Eve app)
                            "double_press": false, // (optional, set to true to enable this action if desired)
                            "long_press": false // (optional, set to true to enable this action if desired)
                        },
                        {
                            "name": "Button2", // (The name does not appear in Home app but appear in Eve app)
                            "double_press": false, // (optional, set to true to enable this action if desired)
                            "long_press": false // (optional, set to true to enable this action if desired)
                        }
                    ]
                    }
                ],
                "windowcoverings": [
                    {
                        "id": "windowcovering1",
                        "name": "Window Covering name 1",
                        "rejectUnauthorized": false, // (optional)
                        "open_url" : "http://your.url/to/open",
                        "open_method" : "GET", // (optional)
                        "open_body": "{ \"open\": true }", // (optional only for POST, PUT and PATCH; use "open_form" for x-www-form-urlencoded JSON)
                        "open_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "open_80_url" : "http://your.url/to/open80%",
                        "open_80_method" : "GET", // (optional)
                        "open_80_body": "{ \"open\": true }", // (optional only for POST, PUT and PATCH; use "open_80_form" for x-www-form-urlencoded JSON)
                        "open_80_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "open_60_url" : "http://your.url/to/open60%",
                        "open_60_method" : "GET", // (optional)
                        "open_60_body": "{ \"open\": true }", // (optional only for POST, PUT and PATCH; use "open_60_form" for x-www-form-urlencoded JSON)
                        "open_60_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "open_40_url" : "http://your.url/to/open40%",
                        "open_40_method" : "GET", // (optional)
                        "open_40_body": "{ \"open\": true }", // (optional only for POST, PUT and PATCH; use "open_40_form" for x-www-form-urlencoded JSON)
                        "open_40_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "open_20_url" : "http://your.url/to/open20%",
                        "open_20_method" : "GET", // (optional)
                        "open_20_body": "{ \"open\": true }", // (optional only for POST, PUT and PATCH; use "open_20_form" for x-www-form-urlencoded JSON)
                        "open_20_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "close_url" : "http://your.url/to/close",
                        "close_method" : "GET", // (optional)
                        "close_body": "{ \"open\": false }", // (optional only for POST, PUT and PATCH; use "close_form" for x-www-form-urlencoded JSON)
                        "close_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "auto_set_current_position": true // (optional, default: false)
                     }
                ],
                "lockmechanisms": [
                    {
                        "id": "lockmechanism1",
                        "name": "Lock Mechanism name 1",
                        "rejectUnauthorized": false, // (optional)
                        "open_url" : "your url to unlock the lock mechanism", // (optional)
                        "open_method" : "GET",// (optional)
                        "open_body": "{ \"open\": true }", // (optional only for POST, PUT and PATCH; use "open_form" for x-www-form-urlencoded JSON)
                        "open_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "close_url" : "your url to lock the lock mechanism", // (optional)
                        "close_method" : "GET", // (optional)
                        "close_body": "{ \"open\": false }", // (optional only for POST, PUT and PATCH; use "close_form" for x-www-form-urlencoded JSON)
                        "close_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}" // (optional)
                    }
                ],
                "fanv2s": [
                    {
                        "id": "fanv21",
                        "name": "Fanv2 name 1",
                        "rejectUnauthorized": true, // (optional)
                        "on_url": "your url to call when the fanv2 is turned on",
                        "on_method": "GET",
                        "on_body": "{ \"on\" : true }",
                        "on_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}",
                        "off_url": "your url to call when the fanv2 is turned off",
                        "off_method": "GET",
                        "off_body": "{ \"off\" : true }",
                        "off_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}",
                        "speed_url": "your url to call when the fanv2 speed is changed",
                        "speed_method": "GET",
                        "speed_body": "{ \"on\" : %statusPlaceholder, \"speed\" : %speedPlaceholder}",
                        "speed_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}",
                        "speed_factor":2.55,
                        "enableLockPhysicalControls": true,
                        "lock_url": "your url to call when the fanv2's physical controls are locked",
                        "lock_method": "GET",
                        "lock_body": "{ \"physicalLock\": true }",
                        "lock_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}",
                        "unlock_url": "your url to call when the fanv2's physical controls are unlocked",
                        "unlock_method": "GET",
                        "unlock_body": "{ \"physicalLock\": false }",
                        "unlock_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}",
                        "enableTargetStateControls": true,
                        "target_state_url": "your url to call when the fanv2's target state is changed",
                        "target_state_method": "GET",
                        "target_state_body": "{ \"mode\": %targetState }",
                        "target_state_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}",
                        "enableSwingModeControls": true,
                        "swing_mode_url": "your url to call when the fanv2's swing mode is changed",
                        "swing_mode_method": "GET",
                        "swing_mode_body": "{ \"swing_mode\": %swingMode }",
                        "swing_mode_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}",
                        "rotation_direction_url": "your url to call when the fanv2's rotation direction is changed",
                        "rotation_direction_method": "GET",
                        "rotation_direction_body": "{ \"rotation_direction\": %rotationDirection }",
                        "rotation_direction_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}"
                    }
                ],
                "valves": [
                    {
                        "id": "valve1",
                        "name": "Valve name 1",
                        "type": "generic valve", // (optional)
                        "rejectUnauthorized": false, // (optional)
                        "on_url": "your url to call when the valve is turned on", // (optional)
                        "on_method": "GET", // (optional)
                        "on_body": "{ \"on\" : true }", // (optional only for POST, PUT and PATCH; use "on_form" for x-www-form-urlencoded JSON)
                        "on_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}", // (optional)
                        "off_url": "your url to call when the valve is turned off", // (optional)
                        "off_method": "GET", // (optional)
                        "off_body": "{ \"on\": false }", // (optional only for POST, PUT and PATCH; use "off_form" for x-www-form-urlencoded JSON)
                        "off_headers": "{\"Authorization\": \"Bearer ABCDEFGH\", \"Content-Type\": \"application/json\"}" // (optional)
                    }
                ]
            }
        ]
    }
```

## Cache Directory Storage (cache_directory)
The cache directory stores accessory state. For a new installation, use a dedicated
directory that the Homebridge user can write to. When upgrading, keep the existing
directory and its contents. Garage and lock snapshots also use a sibling directory
named `<resolved cache_directory>.plus-state-v1/`; include both directories in backups.

## HTTPS
If you want to create a secure connection for the webhooks you need to enable it by setting *https* to true. Then a self signed
ssl certificate will be created automatically and a secure connection will be used. If you want to use your own generated ssl certificate you can do this by setting the values for *https_keyfile* and *https_certfile* to the corresponding file paths.

## Shared HTTP and logging controls

These reliability controls apply independently of the garage/lock state API.
Every command accessory uses the same HTTP/HTTPS transport with configurable
timeouts and response limits. Commands are never automatically retried. These
settings keep existing command URLs and placeholder substitutions working.

| Setting | Scope | Default / bounds |
| --- | --- | --- |
| `log_level` | Platform and each accessory | `inherit`, or `error`, `warn`, `info`, `debug` |
| `extra_redaction_keys` | Platform | Empty; at most 32 field names (letters/digits/underscore/hyphen, 1–64 characters) |
| `request_timeout_ms` | Each command accessory | 10000; 100–60000 ms total across redirects |
| `response_max_bytes` | Each command accessory | 65536; 1024–1048576 bytes total across redirects |
| `max_redirects` | Each command accessory | 0 (disabled); 0–5, same origin only |
| `rejectUnauthorized` | Each command accessory | true; false allows local/self-signed TLS certificates |
| `webhook_timeout_ms` | Platform listener | 10000; 1000–60000 ms |
| `webhook_body_max_bytes` | Platform legacy routes | 65536; 1024–1048576 bytes |
| `state_api_body_max_bytes` | Platform v1 routes | 8192; 1024–65536 bytes |

Accessory `inherit` uses the platform setting. Platform `inherit` delegates to
Homebridge logging. Selecting `debug` still requires Homebridge's effective
(main or child-bridge) debug logging; the plugin never forces that gate open.
Reads and HTTP completion detail use debug, and state-event messages use info.
Credentials and custom secret keys are redacted at every level. Request/response
bodies and full headers are never dumped; there is no raw-secrets mode.

Configure these controls in **Webhook Settings** or each device's HTTP/logging
section. Forms are optional JSON objects with string, finite number or boolean
values (`0` and `false` included); leave raw body empty when using a form.
[Compatibility](docs/COMPATIBILITY.md) explains deliberate validation and redirect
changes from upstream. The listener retains host/port, Basic auth, TLS certificate
and CORS choices. Use `webhook_listen_host: "127.0.0.1"` when every caller is local;
CORS is not authentication. Provide both Basic credentials or neither, and both
TLS file paths or neither (automatic certificates remain supported).

### Observing expired feedback in Home

The state API reports `availability.currentState: "stale"` when a configured
feedback deadline expires, and HAP reads return an unavailable error. Home may
continue displaying its cached value until it refreshes. Reopening Home can
reveal No Response, and returning to the fresh state may also take time. This
is distinct from the physical position and from network/startup failures.

### External actions

Enable **Allow external actions** on a controllable device, save settings and
restart its bridge. With this option enabled, add `action=on` to an incoming
webhook to execute the same configured HTTP command as a HomeKit tile change.
`action=off`, or no action parameter, only reports state. “Off” here disables
execution; it does not turn the device off.

```text
/?accessoryId=example-light&state=true&action=on
/?accessoryId=example-light&state=false&action=on
/?accessoryId=example-light&state=true
```

The first two commands run the configured on/off URLs respectively; the third
only reports that the tile is on. GET works with UniFi Protect. POST accepts the
same query parameters and ignores its body (for alarm metadata) after enforcing
request size/deadline limits. Body fields cannot override the query command.
Existing listener Basic authentication or the optional global Bearer token applies; the garage/lock JSON State API
and its token are unchanged. Do not expose command URLs publicly.

Each command contains exactly one control field, besides `accessoryId` and
`action`. Current-state feedback, extra fields and multiple controls are rejected
before any action or state mutation. The API calls page builds the proper URL,
shows accepted values, and runs a request only on an explicit click.

| Devices | Command field | Accepted command values |
| --- | --- | --- |
| Switches, outlets, lights, fans, valves | `state` | `true` / `false` |
| Lights | `value` | HomeKit brightness 0–100, integer; outgoing brightness_factor applies |
| Push buttons | `state` | `true`, executes push_url and automatically releases |
| Garage doors | `targetdoorstate` | 0 open, 1 close |
| Locks | `locktargetstate` | 0 unlock, 1 lock |
| Window coverings | `targetposition` | 0–100, integer, existing position-to-command mapping |
| Thermostats | `targettemperature` | Configured temperature range and step, °C |
| Thermostats | `targetstate` | 0 off, 1 heat, 2 cool, 3 auto |
| Security systems | `targetstate` | 0 stay, 1 away, 2 night, 3 disarm |
| Fans | `speed` | 0–100, integer; outgoing speed_factor applies |
| Fans | `rotationDirection` | 0 clockwise, 1 counterclockwise |
| Fans, if configured | `swingMode`, `targetState`, or `lockstate` | 0 / 1, one field per command |

Sensors, CO₂ sensors, doorbells and stateless switches have no outgoing action
handlers. Continue reporting their readings/events and use Home automations.
There is no toggle command: repeated requests explicitly request the same target,
which avoids reversing a device when an alarm is repeated.

Window coverings retain the legacy HomeKit handler mapping: target 0 selects
open_url, 1–25 open_20_url, 26–45 open_40_url, 46–65 open_60_url,
66–94 open_80_url and 95–100 close_url. This mapping differs from the usual
HomeKit position naming; existing configurations are not remapped.

Commands require a configured outgoing URL. They preserve existing HomeKit
state behavior, including external feedback versus optimistic garage/lock modes.
HTTP 200 with `commandCompleted: true` means the configured HTTP request
completed successfully, not that physical movement finished. Outgoing errors
return 502 with a sanitized error. Other errors include 400 invalid/ambiguous
command, 403 external actions disabled, and 409 missing outgoing URL.
A timeout or interrupted response can leave the command outcome unknown.
Neither the listener nor the reference page automatically retries a command.

### Incoming Bearer authentication

Set **Webhook Bearer token** in Webhook settings → Authentication and HTTPS to
require authentication on incoming reports and actions for every accessory.
Click **Generate token** to create a secure random 64-character token, then
use **Show** to copy it into your external program. Save settings and restart
the child bridge to apply it. Existing tokens stay unchanged until you edit or
generate a replacement. You can also enter a random 32–256 character token
containing letters, numbers, underscores
or hyphens. For example, generate one with `openssl rand -hex 32`.
Choose Bearer or Basic authentication; clear the Basic user/password when
switching to Bearer. Omit or clear the token to retain existing authentication.

In UniFi Protect, choose **Bearer** and enter the token alone. Alternatively,
choose **None** and add a custom header named `Authorization` with the value
`Bearer YOUR_TOKEN`. Do not put the token in the URL. With HTTPS the token is
encrypted in transit; a token grants access to all devices protected by it.

To exempt an accessory, enable **Disable Bearer authentication for this device**
in its Incoming authentication settings. Only that saved accessory is exempt;
query/body fields cannot disable authentication. External action enablement is
still required separately. The garage/lock JSON State API continues requiring
its own `X-Webhooks-Token`, even on a Bearer-exempt accessory.

The API calls page shows placeholder credentials in copied examples. Its
in-page runner loads the saved token on the server, follows per-device opt-outs,
and redacts the token from returned output. Authentication failures return 401
before any reports or actions run.
