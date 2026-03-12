
import Gio     from 'gi://Gio'

// Make the subprocess functions async-ready
//
// https://gjs.guide/guides/gio/subprocesses.html
Gio._promisify(Gio.Subprocess.prototype, 'communicate_async')
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async')
Gio._promisify(Gio.Subprocess.prototype, 'wait_async')
Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async')

Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish_utf8')
