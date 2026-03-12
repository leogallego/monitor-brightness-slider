
// This is a lock to ensure that only one async task runs between
// acquire() and release(). On release, the next task waiting to
// acquire the lock is started immediately.
export class Lock {

  constructor () {
    this._cont = []
    this._locked = false
  }

  acquire () {
    return new Promise(resolve => {
      if (!this._locked) {
        this._locked = true
        resolve()
      } else {
        this._cont.push(resolve)
      }
    })
  }

  release () {
    return new Promise(resolve => {
      resolve()
      if (this._cont.length) {
        this._cont.shift()()
      } else {
        this._locked = false
      }
    })
  }
}
