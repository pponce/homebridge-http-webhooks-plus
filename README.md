# Homebridge HTTP Webhooks Plus

**Bring devices and alerts from other systems into Apple Home—and control them
from Home, Siri, or your own automations.**

HTTP Webhooks Plus lets another app or device send a message to Homebridge to
update a light, switch, sensor, or other accessory in Apple Home. These messages
are called *webhooks*. You can also use a webhook to run an action you have
configured, such as turning on a real light.

## Why use it?

- **Set up devices without editing code or JSON.** Add and edit accessories
  through a device configurator with clear groups of settings and validation.
- **Connect alerts to Home automations.** For example, let a camera’s motion
  alert update a motion sensor, then use a Home automation to turn on a light.
- **Control devices from either side.** Use a Home tile or Siri to run a configured
  action, or let an external program call the same action directly.
- **Build and test calls from the Settings page.** Each device has an API calls
  page showing what it accepts, with ready-to-copy examples and test buttons.
  The result appears below the buttons so you can see whether the call worked.
- **Protect incoming calls with a token.** Generate a Bearer token in the UI,
  require it for your accessories, and exempt individual devices when needed.
- **Get better feedback for garages and locks.** Optional settings let Homebridge
  wait for a real state report and flag feedback that has stopped arriving.

## What can I connect?

| Accessory | Examples |
| --- | --- |
| Lights and switches | Lights with brightness, switches, outlets and push buttons |
| Sensors and alerts | Motion, contact, occupancy, smoke, temperature, humidity, air quality, light level, CO₂, leaks and doorbells |
| Other controls | Garage doors, locks, window coverings, fans, valves, thermostats and security systems |

The plugin creates accessories in Homebridge. To control physical hardware, you
supply a working action URL from a device, service, or integration that can
operate it. To show its actual state, that system must send state reports back.
The plugin does not discover or connect to every device automatically.

## What you need

- A working [Homebridge](https://homebridge.io/) installation, with Node.js 18 or
  newer, connected to Apple Home.
- An app, device, or service that can send webhooks. UniFi Protect is one example.
- For physical control, a service or device that accepts an HTTP request to
  perform the action you want.

**Already using the original HTTP Webhooks plugin?** Follow the
[upgrade guide](docs/COMPATIBILITY.md) first to keep your existing accessories
and settings. The original plugin and Plus should not run together.

## Install and add your first device

1. In Homebridge, open **Plugins**, search for **homebridge-http-webhooks-plus**,
   and install it.
2. Open the plugin’s **Settings** and click **Add device**.
3. Choose the device type, give it a name, and enter a unique ID. The ID is how
   incoming messages identify the accessory; keep it unchanged once in use.
4. If you want it to control something, enter the appropriate action URLs in
   its grouped settings—for example, the URLs that turn a light on and off.
5. Click **Add device** for a new accessory, or **Apply changes** after editing
   an existing one. Then click Homebridge’s bottom **Save** button.
6. Restart the child bridge, or Homebridge if you are not using a child bridge,
   to load the changes.

You do not need to write a configuration file. Homebridge’s green checkmark
means your settings are **ready to save**, not that they have already been saved.
Save stays disabled while an accessory edit is open, settings need correction,
or changes are still being prepared. The page explains what to do next.

## Update a tile—or perform its action

These are two different uses, and you choose which one you want:

| What you want | What happens |
| --- | --- |
| **Report state** | Tell Home that a light is on, a door is closed, or a sensor detected something. The plugin updates Home without calling the device’s configured action URL. |
| **Run action** | Ask the plugin to execute the same configured action that a Home tile would run, such as turning a light on. |

A state report is useful when another system has already operated the device,
or when you want a sensor report or button event to trigger a Home automation.
A run-action call is useful when the external system wants this plugin to
operate the device.

To allow action calls, edit the accessory and enable **Allow external actions**.
Apply the change, save, and restart its bridge. In the device’s **API calls**
page, choose **Run action** and select the action you want. An outgoing URL must
be configured for that action. Sensors and devices that only report events have
no outgoing action to run.

For integrations, adding `action=on` to the generated URL enables execution.
Leaving it out—or using `action=off`—keeps the existing state-report behavior.
The selected value determines what the device does: for example,
`state=false&action=on` runs a light’s **off** action. Command completion does not
prove that physical hardware finished moving; state reports provide that feedback.

## Copy and test a call

Click **API calls** beside a device. Choose the kind of call and the desired
value. The page shows accepted values and generates a URL and other examples
that you can copy into your external program.

Click **Send state report**, **Send event**, or **Run action** to test it. The
HTTP status and response appear below the buttons. Garage and lock pages also
include **Read status**. Opening the page or changing an example sends nothing;
a request runs only when you click a test button.

In-page tests use the saved credentials and a detected local Homebridge address.
Save and restart before testing changed settings. You can change the example
address for calls made by your external program, including a reverse-proxy
address. **Run action can operate real hardware.** Disabled test buttons explain
which requirement needs attention.

## Protect your webhooks

In **Webhook settings → Authentication and HTTPS**, find **Webhook Bearer token**.
Click **Generate token** to create one, then **Show** to copy it. Save and restart
the bridge to activate it.

A token acts like a password for incoming calls. When configured, it is required
for both state reports and action calls. To exempt a particular accessory,
enable **Disable Bearer authentication for this device** in that accessory’s
settings. Allowing actions remains a separate choice.

The API page hides the token behind a placeholder by default. Check **Include
Bearer token** to put it in the copyable header and command examples. The page
warns that this exposes the token; leave it unchecked when sharing examples.

Use **HTTPS** for calls across your network. The token controls access; HTTPS
protects it in transit. You can use the plugin’s HTTPS settings or let a reverse
proxy such as nginx handle HTTPS and forward locally to the plugin.

### Using UniFi Protect

In UniFi Protect’s webhook action:

- Copy the URL from this plugin’s **API calls** page, using an address reachable
  from your UniFi console.
- Choose **GET** as the request method.
- Choose **Bearer** authentication and paste **only the token** into its token
  field. UniFi adds the required Authorization header; no request body is needed.
- Use a state-report URL to update Home, or a run-action URL to execute the
  configured action.

Match the plugin’s actual listener port when configuring a proxy. The default
is **51828**; your Homebridge web interface and child bridge use separate ports.

## More help and advanced settings

- [Technical reference](docs/REFERENCE.md): configuration UI details, supported
  action fields, request examples, HTTPS, logging and the full configuration example.
- [Garage and lock State API](docs/STATE_API.md): status reads, feedback and JSON updates.
- [Upgrade guide](docs/COMPATIBILITY.md): moving from the original plugin and
  preserving existing accessories.
- [Release notes](CHANGELOG.md): changes by version.
- [Report an issue](https://github.com/pponce/homebridge-http-webhooks-plus/issues).

Built on [homebridge-http-webhooks](https://github.com/benzman81/homebridge-http-webhooks)
by benzman81. The original attribution and GPL-3.0 license are retained.
