# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GNOME Shell extension that adds a brightness slider to the QuickSettings panel for controlling external monitors via DDC/CI using `ddcutil`. UUID: `monitor-brightness-slider@leogallego`. Supports GNOME Shell 45-49.

## Build & Install

```bash
# Compile GSettings schema (required after schema changes)
glib-compile-schemas schemas/

# Install extension for current user
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/monitor-brightness-slider@leogallego

# Restart GNOME Shell (X11 only; on Wayland, log out and back in)
busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting…")'

# View extension logs
journalctl -f -o cat /usr/bin/gnome-shell | grep 'monitor-brightness-slider'
```

No build system, bundler, or tests exist. The extension is pure JavaScript loaded directly by GNOME Shell.

## Architecture

- `extension.js` — Main entry point. `MonitorBrightnessSliderExtension` class handles `enable()`/`disable()` lifecycle, monitor detection loop, keyboard shortcuts, and slider callback. Adds brightness slider to QuickSettings via `SystemIndicator`.

- `js/ddcutilWrapper.js` — Spawns `ddcutil` subprocesses for `detect`, `getvcp`, and `setvcp` commands. Parses terse output. Uses a `Lock` to serialize I2C bus access and prevent bus congestion.

- `js/ddcutilHelper.js` — Higher-level helpers: `_getVcpValid` queries a VCP code across multiple buses, `_setVcpAllScaleInt` sets a value on all buses with per-bus max range scaling.

- `js/setValueIntent.js` — Debounce/coalesce pattern for slider changes. Since DDC is slow, queued `setValue` calls collapse so only the latest desired value is applied.

- `js/ui/sliderItem.js` — Base `QuickSlider` subclass with a monitor icon indicator.
- `js/ui/brightnessItem.js` — Brightness slider (VCP code `0x10`).

- `js/lock.js` — Promise-based mutex for serializing async operations.
- `js/processManager.js` + `js/killableProcess.js` — Process lifecycle management with cancellation support. All spawned `ddcutil` processes are tracked and killed on `disable()`.
- `js/promisify.js` — Promisifies GIO subprocess methods for async/await usage.

## Documentation Reference

Use https://gjs.guide/extensions/ as the **primary source** for GNOME Shell extension development. Before implementing or advising on any of the following topics, query this site via the context7 MCP tool (`resolve-library-id` then `query-docs`):

- Recommended practices and extension architecture
- GJS imports, modules, and GObject subclassing
- UI components, dialogs, and QuickSettings
- Preferences and GSettings
- Debugging and logging
- Accessibility
- Session modes and lifecycle (`enable`/`disable`)
- Notifications, indicators, and panel integration
- Any other GNOME extension development topic

This takes precedence over general web knowledge. Always consult it before falling back to other sources.

## Key Patterns

- **GObject subclassing**: UI classes use `GObject.registerClass()` with `_init()` instead of constructors.
- **GJS imports**: Uses `gi://` URIs for GNOME libraries and `resource:///` for Shell internals.
- **I2C bus serialization**: All ddcutil calls are serialized through `Lock` to prevent I2C bus congestion. Multiple monitors are queried in parallel only at the `DdcutilHelper` level after acquiring the lock per-command.
- **Startup timing**: Extension delays initialization until `startup-complete` or after a 5-second settle period to avoid I2C conflicts during display detection.
- **Settings schema**: GSettings schema in `schemas/org.gnome.shell.extensions.monitor-brightness-slider.gschema.xml` — configurable keyboard shortcuts and retry count.
