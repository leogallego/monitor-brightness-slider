
import GLib    from 'gi://GLib'
import Meta    from 'gi://Meta'
import Shell   from 'gi://Shell'

import * as Main           from 'resource:///org/gnome/shell/ui/main.js'
import * as QuickSettings  from 'resource:///org/gnome/shell/ui/quickSettings.js'

import {Extension}         from 'resource:///org/gnome/shell/extensions/extension.js'

import {MVBrightnessItem}  from './js/ui/brightnessItem.js'
import {LOG, castInt, isEmpty, avgVM, sleep, clearAllTimeouts} from './js/utils.js'
import {Lock}              from './js/lock.js'
import {SetValueIntent}    from './js/setValueIntent.js'
import {DdcutilWrapper}    from './js/ddcutilWrapper.js'
import {DdcutilHelper}     from './js/ddcutilHelper.js'

import './js/promisify.js'


// vcp code for brightness
const VCP_BRIGHTNESS = '10'

// delay after monitors-changed detected
//
// if we try to run ddcutil immediately when monitors-changed happens,
// it can break the display configuration because of I2C bus
// congestion
const MONITORS_CHANGED_SETTLE_MS = 5000
// DDC is really bad, please be patient
const RETRY_DELAY_MS = 1000

// adjustment per key-press when using keyboard shortcuts
const KEYBOARD_STEP = 2


// The extension adds a Brightness slider to the QuickSettings menu.
// This slider controls the externally connected monitor(s)
export default class MonitorBrightnessSliderExtension extends Extension {

  // Find connected monitors and current brightness levels
  async _readInitialValues () {
    // we don't want to accidentally be in this function twice at the
    // same time
    await this._readInitialValuesLock.acquire()
    LOG("Searching for DDC/I2C monitors")
    let detectedMonitors = {}
    const detected = { _brightness: {} }

    // before starting the detection, we re-set the "set by user" state of the slider
    this._brightness._userSet = false

    // DDC is unreliable, so try to detect monitors multiple times
    const maxRetry = Math.clamp(this._settings.get_uint('ddcutil-retries'), 1, 10)
    for (let retry = 1; retry <= maxRetry; retry += 1) {

      const found = await this._ddcutilWrapper?.detect(1)
      const newfound = Object.keys(found).filter(e => !(e in detectedMonitors))
      if (!newfound.length) {
        await sleep(RETRY_DELAY_MS)
        continue
      }

      detectedMonitors = {...detectedMonitors, ...found}
      this._monitorBus = Object.keys(detectedMonitors)

      const value = await this._ddcutilHelper?._getVcpValid(VCP_BRIGHTNESS, newfound, maxRetry)
      detected._brightness = {...detected._brightness, ...value}

      if (!isEmpty(value)) {
        const val = avgVM(Object.values(detected._brightness))

        // skip changing the slider if the user already has tried to
        // set it to a new value
        if (!this._brightness._userSet)
          this._brightness._changeSlider(val)

        this._brightnessBus = Object.keys(detected._brightness)
        this._brightnessBusMaxRng = Object.fromEntries(
          Object.keys(detected._brightness).map(k => [k, detected._brightness[k][1]]))
        this._brightnessAvailable = true

        this._brightness.visible = true
        this._setBrightnessKeys(true)
      }
    }

    if (isEmpty(detected._brightness)) {
      this._brightnessBus = []
      this._brightnessBusMaxRng = []
      this._brightnessAvailable = false
      this._brightness.visible = false
      this._setBrightnessKeys(false)
    }

    if (isEmpty(detectedMonitors))
      LOG("Warning: no monitors found on I2C, extension sleeping")

    await this._readInitialValuesLock.release()
  }

  // (dis)connect global keyboard shortcuts for monitor brightness
  _setBrightnessKeys (enabled) {
    if (enabled) {
      if (!this._brightnessKeys) {
        Main.wm.addKeybinding(
          'monitor-screen-brightness-up',
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.ALL,
          this.brightnessUpKey.bind(this)
        )
        Main.wm.addKeybinding(
          'monitor-screen-brightness-down',
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.ALL,
          this.brightnessDownKey.bind(this)
        )
        this._brightnessKeys = true
      }
    } else {
      if (this._brightnessKeys) {
        Main.wm.removeKeybinding('monitor-screen-brightness-up')
        Main.wm.removeKeybinding('monitor-screen-brightness-down')
        this._brightnessKeys = false
      }
    }
  }

  // callback for the _brightness.slider::value to actually launch the
  // setBrightness ddcutil command
  async setBrightness (value) {
    this._brightness._userSet = true
    await this._setBrightnessIntent?.setValue(castInt(value), this._brightnessBusMaxRng, this._brightnessBus)
  }

  // methods for the global keyboard shortcuts (they change the slider value)
  async brightnessUpKey () {
    const newValue = Math.min(1, this._brightness?.slider.value + (KEYBOARD_STEP / 100))
    this._brightness.slider.value = newValue
    Main.osdWindowManager.show(-1, this._brightness.gicon, 'Monitor', newValue, 1)
  }

  async brightnessDownKey () {
    const newValue = Math.max(0, this._brightness?.slider.value - (KEYBOARD_STEP / 100))
    this._brightness.slider.value = newValue
    Main.osdWindowManager.show(-1, this._brightness.gicon, 'Monitor', newValue, 1)
  }

  // callback when a change in monitor configuration was detected
  _monitorsChanged () {
    if (this._monitorsChangedId) {
      GLib.Source.remove(this._monitorsChangedId)
      this._monitorsChangedId = null
    }
    LOG(`Please wait (${MONITORS_CHANGED_SETTLE_MS}ms) for i2c to clear`)
    this._monitorsChangedId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
      MONITORS_CHANGED_SETTLE_MS, () => {
        this._monitorsChangedId = null
        this._readInitialValues().catch(e => console.error(e))
        return GLib.SOURCE_REMOVE
      })
  }

  enable () {
    this._ddcutilWrapper = new DdcutilWrapper()
    this._ddcutilHelper = new DdcutilHelper(this._ddcutilWrapper)

    this._readInitialValuesLock = new Lock()
    this._setBrightnessIntent = new SetValueIntent(
      this._ddcutilHelper._setVcpAllScaleInt.bind(this._ddcutilHelper), VCP_BRIGHTNESS)

    this._brightness = new MVBrightnessItem(this)
    this._brightness.visible = false

    this._settings = this.getSettings()

    // add our slider to the QuickSettings menu using the public API
    this._indicator = new QuickSettings.SystemIndicator()
    this._indicator.quickSettingsItems.push(this._brightness)
    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator)

    const startup = () => {
      if (this._startupCompleteSignal) {
        Main.layoutManager.disconnect(this._startupCompleteSignal)
        this._startupCompleteSignal = null
      }

      this._readInitialValues()
        .then(() => {
          // listen for changes in monitor configuration, to re-trigger monitor detection
          this._monitorsChangedSignal = Main.layoutManager.connect(
            'monitors-changed', this._monitorsChanged.bind(this))
        })
        .catch(e => console.error(e))
    }

    // if mutter starts and the screens are being detected, our
    // extension launches too early and can break the display
    // detection because of I2C bus congestion
    if (Main.layoutManager._startingUp) {
      LOG('Please wait (for startup-complete) for i2c to clear')
      this._startupCompleteSignal = Main.layoutManager.connect(
        'startup-complete', startup)
    } else {
      if (this._startupId) {
        GLib.Source.remove(this._startupId)
        this._startupId = null
      }
      LOG(`Please wait (${MONITORS_CHANGED_SETTLE_MS}ms) for i2c to clear`)
      this._startupId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
        MONITORS_CHANGED_SETTLE_MS, () => {
          this._startupId = null
          startup()
          return GLib.SOURCE_REMOVE
        })
    }
  }

  disable () {
    if (this._monitorsChangedId) {
      GLib.Source.remove(this._monitorsChangedId)
      this._monitorsChangedId = null
    }

    if (this._startupId) {
      GLib.Source.remove(this._startupId)
      this._startupId = null
    }

    clearAllTimeouts()

    if (this._startupCompleteSignal) {
      Main.layoutManager.disconnect(this._startupCompleteSignal)
      this._startupCompleteSignal = null
    }

    if (this._monitorsChangedSignal) {
      Main.layoutManager.disconnect(this._monitorsChangedSignal)
      this._monitorsChangedSignal = null
    }

    this._settings = null

    this._setBrightnessKeys(false)

    this._brightness.destroy()
    this._brightness = null

    this._indicator.destroy()
    this._indicator = null

    this._readInitialValuesLock = null
    this._setBrightnessIntent = null

    this._ddcutilHelper = null

    this._ddcutilWrapper._pm.killAllRunningProcesses()
    this._ddcutilWrapper = null
  }
}
