
import Gio     from 'gi://Gio'

import {KillableProcess} from './killableProcess.js'

// keep track of running processes
export class ProcessManager {

  constructor (launcher) {
    this._launcher = launcher
    this._runningProcesses = []
  }

  spawn (argv) {
    let kProc
    const proc = this._launcher.spawnv(argv)
    const cancellable = new Gio.Cancellable()
    // this crashes gnome-shell with
    //
    //   Bail out!
    //   GLib-GIO:ERROR:../gio/gsubprocess.c:276:g_subprocess_exited:
    //   assertion failed: (self->pid == pid)
    //
    // because the Launcher has already commenced the init step
    // // proc.init(cancellable)

    kProc = new KillableProcess(
      proc,
      cancellable,
      () => {
        const idx = this._runningProcesses.indexOf(kProc)
        if (idx !== -1)
          this._runningProcesses.splice(idx, 1)
      })
    this._runningProcesses.push(kProc)
    return kProc
  }

  killAllRunningProcesses () {
    for (const proc of this._runningProcesses)
      proc.kill()
    this._runningProcesses = []
  }

}
