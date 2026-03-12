
import GLib from 'gi://GLib'

export const LOG = msg => console.log('### monitor-brightness-slider@leogallego ### ' + msg)

export const castInt = num => ~~num

export const isEmpty = obj => {
  for (const x in obj)
    return false
  return true
}

export const avgVM = arr => arr
  .reduce((a, b) => [100 * (a[0] / a[1] + b[0] / b[1]), 100])[0] / arr.length

let activeSources = new Set()

export const clearAllTimeouts = () => {
  for (const sourceId of activeSources)
    GLib.Source.remove(sourceId)
  activeSources.clear()
}

export const sleep = ms => new Promise(resolve => {
  const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    activeSources.delete(sourceId)
    resolve()
    return GLib.SOURCE_REMOVE
  })
  activeSources.add(sourceId)
})
