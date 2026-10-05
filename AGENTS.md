# Project instructions

This is an independent, generic Homebridge plugin. It must work without any
particular custom controller, household configuration or private repository.
Use neutral examples and keep deployment-specific patches, markers, migrations,
credentials and hardware sequencing outside this repository and npm package.

Release 0.2.1 is a package-name migration of upstream 0.2.0. Its exact source
fingerprint tests intentionally enforce unchanged accessory behavior. Introduce
future features with meaningful behavioral tests, documented configuration and
legacy compatibility, updating the fingerprint boundary only for reviewed changes.

Preserve platform/accessory aliases, UUID inputs, service/characteristic identities,
storage keys and existing config unless a deliberate migration is implemented.
Keep optimistic virtual devices supported. Future external-state, notifications,
startup/freshness and API behavior must be configurable and usable by any client.
Obstruction belongs to garage accessories, not locks. Never equate command
acceptance, cached relay state or elapsed time with physical position.

Keep GPL licensing and upstream attribution. Inspect the npm tarball before
publishing. Tests use synthetic state and must never operate real hardware.
