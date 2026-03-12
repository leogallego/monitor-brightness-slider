
import Gio     from 'gi://Gio'

import {LOG}            from './utils.js'
import {Lock}           from './lock.js'
import {ProcessManager} from './processManager.js'

// Class for calling the `ddcutil' binary. Proper set-up of ddcutil
// permissions for the user is required, see
// http://www.ddcutil.com/i2c_permissions/
export class DdcutilWrapper {

  constructor () {
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
    })
    // ensure we do not get any translated texts when parsing command response
    launcher.setenv('LC_ALL', 'C.UTF-8', true)
    this._pm = new ProcessManager(launcher)

    // this lock stops multiple ddcutils from running in parallel (at
    // least as far as this extension is concerned), which often clogs
    // the I2C bus and leads to detection or command execution errors
    this._processLock = new Lock()
  }

  // http://www.ddcutil.com/command_detect/
  async _detect () {
    await this._processLock.acquire()
    const [stdout, ] = await this._pm.spawn(
      ['ddcutil', 'detect', '--terse'])
          .communicate_utf8_async(null)
    await this._processLock.release()

    const monitors = {}

    // Example output we are looking for:
    //
    // some users reported garbage in front, so skip it first
    // Display 1
    //   I2C bus:             /dev/i2c-7
    //   Monitor:             ACR:Acer X243W:LAG040064310
    //
    // Note: additional keys and values can be present.

    for (const block of stdout.split(/\n\n/)) {
      let bus = null, monitor = null, start = false
      for (const line1 of block.split(/\n/)) {
        if (!start) {
          if (line1.startsWith('Invalid display'))
            break
          if (line1.startsWith('Phantom display'))
            break
          if (line1.startsWith('Display '))
            start = true
        } else {
          const line2 = line1.trim()
          if (line2.startsWith('I2C bus:'))
            bus = line2.substring(line2.indexOf(':') + 1).trim().substring(9)
          else if (line2.startsWith('Monitor:'))
            monitor = line2.substring(line2.indexOf(':') + 1).trim()
        }
      }
      if (bus !== null)
        monitors[bus] = monitor
    }
    return monitors
  }

  // DDC is unreliable, so we repeat the detection `retry'
  // times and hope for the best
  async detect (retry = 3) {
    let detectedMonitors = {}

    while (retry > 0) {
      retry -= 1
      const monitors = await this._detect()
      detectedMonitors = {...detectedMonitors, ...monitors}
    }
    return detectedMonitors
  }

  // http://www.ddcutil.com/command_getvcp/
  async _getvcp (code, bus) {
    await this._processLock.acquire()
    const [stdout, ] = await this._pm.spawn(
      ['ddcutil', 'getvcp', '--bus', bus, '--terse', code])
          .communicate_utf8_async(null, null)
    await this._processLock.release()

    if (stdout === null)
      return null

    for (const line of stdout.split(/\n/)) {
      // Either there is no monitor on this bus or it just was not
      // detected _this time_ due to the flakiness of DDC
      if (stdout.startsWith('No monitor detected'))
        return 'No monitor detected'

      const args = stdout.trim().split(' ')
      if (args[0] !== 'VCP')
        continue
      if (args[2] === 'ERR')
        return 'ERR'

      let value
      let maxrng
      // Example outputs:
      // VCP 10 C 50 100
      if (args[2] === 'C') {
        value = args[3]
        maxrng = args[4]
      }
      // VCP 62 CNC x00 x64 x00 x01
      else if (args[2] === 'CNC') {
        value = args[6]
        maxrng = args[4]
      }
      else {
        LOG(`Unknown type: ${args[2]}`)
        return null
      }

      if (value.startsWith('x'))
        value = parseInt(value.substring(1), 16)
      else
        value = parseInt(value, 10)

      if (maxrng.startsWith('x'))
        maxrng = parseInt(maxrng.substring(1), 16)
      else
        maxrng = parseInt(maxrng, 10)

      return [value, maxrng]
    }
    return null
  }

  // Retry the getvcp in case of "No monitor detected" condition
  async getvcp (code, bus, retry = 3) {
    while (retry > 0) {
      retry -= 1

      const res = await this._getvcp(code, bus)
      if (res === 'No monitor detected')
        continue

      return res
    }
    return null
  }

  // Try to set a value
  async setvcp (code, value, bus) {
    await this._processLock.acquire()
    await this._pm.spawn(
      ['ddcutil', 'setvcp', '--bus', bus, '--noverify', code, value])
      .wait_async()
    await this._processLock.release()
  }
}
