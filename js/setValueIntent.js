
import {sleep} from './utils.js'

// The SetValueIntent records the desire for setting a value, but
// skips values if the process for setting a value is still in
// progress. The setter process will be run again until it has been
// executed with the last set value. 
//
// We do this because DDC is *slow*, so try to minimise setting a
// value if previous setting was not finished yet.
export class SetValueIntent {

  // exec: method to call for setting the value
  // ...args: leading arguments for method
  constructor (exec, ...args) {
    // our desired value was set
    this._set = true

    // the setter process is currently running
    this._running = false

    this._exec = exec
    this._args = args
    this.delay = 100
  }

  // ...value: the desired value arguments to use in the call
  async setValue (...value) {
    this._set = false
    this._value = value
    if (!this._running) {
      this._running = true
      // run the setter until the latest desired value was set
      while (!this._set)
        await this._doit()
      this._running = false
    }
  }

  async _doit() {
    await sleep(this.delay)
    const value = this._value
    await this._exec(...this._args, ...value)

    // exit successfully only if the current value is (still)
    // identical to the one we used when calling the setter process
    if (JSON.stringify(value) === JSON.stringify(this._value))
      this._set = true
  }
}
