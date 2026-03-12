
// class that supports killing a process using Gio.Cancellable
export class KillableProcess {
  constructor (proc, cancellable, cleanupCb) {
    this._cleanupCb = cleanupCb
    this._cancelId = cancellable.connect(() => {
      proc.force_exit()
      if (this._cleanupCb)
	this._cleanupCb()
    })
    this._proc = proc
    this._cancellable = cancellable
  }

  async communicate_utf8_async (stdin_buf) {
    const res = await this._proc.communicate_utf8_async(stdin_buf, this._cancellable)
    if (this._cleanupCb)
      this._cleanupCb()
    return res
  }

  async wait_async () {
    const res = await this._proc.wait_async(this._cancellable)
    if (this._cleanupCb)
      this._cleanupCb()
    return res
  }

  kill () {
    this._cancellable.cancel()
  }
}
