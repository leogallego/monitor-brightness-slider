# monitor-brightness-slider

GNOME Shell extension to control external monitor brightness and volume via DDC/CI using `ddcutil`.

Adds brightness and volume sliders to the GNOME QuickSettings panel for DDC/CI-capable monitors. Supports keyboard shortcuts and multiple monitors.

## Prerequisites

- `ddcutil` installed and working from the command line
- I2C permissions configured for your user (see [ddcutil docs](http://www.ddcutil.com/i2c_permissions/))

## Installation

```bash
# Compile schemas
glib-compile-schemas schemas/

# Symlink to GNOME extensions directory
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/monitor-brightness-slider@leogallego
```

Restart GNOME Shell (X11: `Alt+F2` then `r`; Wayland: log out and back in).

## Attribution

This is a fork of [Control monitor brightness and volume with ddcutil](https://gitlab.gnome.org/Nei/gnome-shell-extension-monitor-brightness-volume) by [Nei](https://gitlab.gnome.org/Nei) (extensions.gnome.org user **ailin**).

Original extension UUID: `monitor-brightness-volume@ailin.nemui`

## License

See [LICENSE](LICENSE) for details.
