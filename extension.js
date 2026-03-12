
import GLib    from 'gi://GLib'
import Meta    from 'gi://Meta'
import Shell   from 'gi://Shell'

import * as Main           from 'resource:///org/gnome/shell/ui/main.js'
import * as QuickSettings  from 'resource:///org/gnome/shell/ui/quickSettings.js'

import {Extension}         from 'resource:///org/gnome/shell/extensions/extension.js'

import {MVBrightnessItem}  from './js/ui/brightnessItem.js'
import {MVVolumeItem}      from './js/ui/volumeItem.js'
import {LOG, castInt, isEmpty, avgVM, sleep, clearAllTimeouts} from './js/utils.js'
import {Lock}              from './js/lock.js'
import {SetValueIntent}    from './js/setValueIntent.js'
import {DdcutilWrapper}    from './js/ddcutilWrapper.js'
import {DdcutilHelper}     from './js/ddcutilHelper.js'

import './js/promisify.js'


// vcp codes for the specific monitor features
const VCP_BRIGHTNESS = '10'
const VCP_VOLUMEOUT = '62'

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


// The extension adds a Volume and Brightness slider to the
// QuickSettings menu. These sliders control the externally connected
// monitor(s)
export default class MonitorBrightnessSliderExtension extends Extension {

  // Find connected monitors and current brightness/volume levels
  async _readInitialValues () {
    // we don't want to accidentally be in this function twice at the
    // same time
    await this._readInitialValuesLock.acquire()
    LOG("Searching for DDC/I2C monitors")
    let detectedMonitors = {}
    const detected = { _volume: {}, _brightness: {} }

    // - query the given buses for a specific vcpCode (volume, brightness)
    // - set the slider based on the returned value
    // - store the detected I2C buses and merge with buses detected previously
    //
    // vcpCode: code to query in ddcutil
    // name: name of the property that contains the slider item
    // enabledCb: callback to configure visibility and shortcut keys
    //            if a value was found
    // bus: list of buses to query
    const configureValue = async ({ vcpCode, name, enabledCb, bus }) => {
      const value = await this._ddcutilHelper?._getVcpValid(vcpCode, bus, maxRetry)
      detected[name] = {...detected[name], ...value}

      if (!isEmpty(value)) {
        const val = avgVM(Object.values(detected[name]))

        // skip changing the slider if the user already has tried to
        // set it to a new value
        if (!this[name]._userSet)
          this[name]._changeSlider(val)

        this[name + 'Bus'] = Object.keys(detected[name])
        this[name + 'BusMaxRng'] = Object.fromEntries(
          Object.keys(detected[name]).map(k => [k, detected[name][k][1]]))
        this[name + 'Available'] = true

        enabledCb(name)
      }
    }

    // disable and hide a slider if no values were found
    //
    // name: name of the property that contains the slider item
    // disabledCb: callback to configure visibility and shortcut keys
    //             if no value was found
    const configureNoValue = ({ name, disabledCb }) => {
      if (isEmpty(detected[name])) {
        this[name + 'Bus'] = []
        this[name + 'BusMaxRng'] = []
        this[name + 'Available'] = false
        disabledCb(name)
      }
    }

    // before starting the detection, we re-set the "set by user" state of the sliders
    this._volume._userSet = false
    this._brightness._userSet = false

    // DDC is unreliable, so try to detect monitors multiple times
    const maxRetry = Math.clamp(this._settings.get_uint('ddcutil-retries'), 1, 10)
    for (let retry = 1; retry <= maxRetry; retry += 1) {

      const detected = await this._ddcutilWrapper?.detect(1)
      const newfound = Object.keys(detected).filter(e => !(e in detectedMonitors))
      if (!newfound.length) {
        await sleep(RETRY_DELAY_MS)
        continue
      }

      detectedMonitors = {...detectedMonitors, ...detected}
      this._monitorBus = Object.keys(detectedMonitors)

      await configureValue({
        vcpCode: VCP_VOLUMEOUT,
        name: '_volume',
        enabledCb: this._showVolumeSetting.bind(this),
        bus: newfound
      })

      await configureValue({
        vcpCode: VCP_BRIGHTNESS,
        name: '_brightness',
        enabledCb: (name) => {
          this[name].visible = true
          this._setBrightnessKeys(true)
        },
        bus: newfound
      })

    }

    configureNoValue({
      name: '_volume',
      disabledCb: this._showVolumeSetting.bind(this)
    })

    configureNoValue({
      name: '_brightness',
      disabledCb: (name) => {
        this[name].visible = false
        this._setBrightnessKeys(false)
      }
    })

    if (isEmpty(detectedMonitors))
      LOG("Warning: no monitors found on I2C, extension sleeping")

    await this._readInitialValuesLock.release()
  }

  // optionally, the volume slider can be disabled in the settings
  _showVolumeSetting () {
    this._volume.visible = this._volumeAvailable && this._settings?.get_boolean('show-volume')
    this._setVolumeKeys(this._volumeAvailable && this._settings?.get_boolean('show-volume'))
  }

  // (dis)connect global keyboard shortcuts for monitor volume
  _setVolumeKeys (enabled) {
    if (enabled) {
      if (!this._volumeKeys) {
        Main.wm.addKeybinding(
          'monitor-volume-up',
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.ALL,
          this.volumeUpKey.bind(this)
        )
        Main.wm.addKeybinding(
          'monitor-volume-down',
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.ALL,
          this.volumeDownKey.bind(this)
        )
        this._volumeKeys = true
      }
    } else {
      if (this._volumeKeys) {
        Main.wm.removeKeybinding('monitor-volume-up')
        Main.wm.removeKeybinding('monitor-volume-down')
        this._volumeKeys = false
      }
    }
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

  // callback for the _volume.slider::value to actually launch the
  // setVolume ddcutil command
  async setVolume (value) {
    this._volume._userSet = true
    await this._setVolumeIntent?.setValue(castInt(value), this._volumeBusMaxRng, this._volumeBus)
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

  async volumeUpKey () {
    const newValue = Math.min(1, this._volume?.slider.value + (KEYBOARD_STEP / 100))
    this._volume.slider.value = newValue
    Main.osdWindowManager.show(-1, this._volume.gicon, 'Monitor', newValue, 1)
  }

  async volumeDownKey () {
    const newValue = Math.max(0, this._volume?.slider.value - (KEYBOARD_STEP / 100))
    this._volume.slider.value = newValue
    Main.osdWindowManager.show(-1, this._volume.gicon, 'Monitor', newValue, 1)
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
    this._setVolumeIntent = new SetValueIntent(
      this._ddcutilHelper._setVcpAllScaleInt.bind(this._ddcutilHelper), VCP_VOLUMEOUT)

    this._brightness = new MVBrightnessItem(this)
    this._brightness.visible = false

    this._volume = new MVVolumeItem(this)
    this._volume.visible = false

    this._settings = this.getSettings()
    this._showVolumeSignalId = this._settings.connect(
      'changed::show-volume', this._showVolumeSetting.bind(this))

    // add our sliders to the QuickSettings menu using the public API
    this._indicator = new QuickSettings.SystemIndicator()
    this._indicator.quickSettingsItems.push(this._brightness)
    this._indicator.quickSettingsItems.push(this._volume)
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

    if (this._showVolumeSignalId) {
      this._settings.disconnect(this._showVolumeSignalId)
      this._showVolumeSignalId = null
    }
    this._settings = null

    this._setBrightnessKeys(false)
    this._setVolumeKeys(false)

    this._brightness.destroy()
    this._volume.destroy()
    this._brightness = null
    this._volume = null

    this._indicator.destroy()
    this._indicator = null

    this._readInitialValuesLock = null
    this._setBrightnessIntent = null
    this._setVolumeIntent = null

    this._ddcutilHelper = null

    this._ddcutilWrapper._pm.killAllRunningProcesses()
    this._ddcutilWrapper = null
  }
}
