
import GObject from 'gi://GObject'

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'

import {MVSliderItem} from './sliderItem.js'

// Volume slider
export const MVVolumeItem = GObject.registerClass(
class MVVolumeItem extends MVSliderItem {

  _init (extension) {
    super._init('audio-volume-medium-symbolic', extension)

    // icons copied from gnome-shell's volume.js
    this._icons = [
      'audio-volume-muted-symbolic',
      'audio-volume-low-symbolic',
      'audio-volume-medium-symbolic',
      'audio-volume-high-symbolic'
    ]

    this._sliderChangedSignal = this.slider.connect(
      'notify::value', this._sliderChanged.bind(this))
    this.slider.accessible_name = _('Volume')
  }

  _sliderChanged () {
    const percent = this.slider.value * 100
    this._extension?.setVolume(percent).catch(e => console.error(e))
    this._updateIcon(percent)
  }

  // method to change the slider without triggering the value changed
  // signals
  _changeSlider (percent) {
    this.slider.block_signal_handler(this._sliderChangedSignal)
    this.slider.value = percent / 100
    this._updateIcon(percent)
    this.slider.unblock_signal_handler(this._sliderChangedSignal)
  }

  _updateIcon (percent) {
    if (percent < 1)
      this.iconName = this._icons[0]
    else if (percent < 34)
      this.iconName = this._icons[1]
    else if (percent < 67)
      this.iconName = this._icons[2]
    else
      this.iconName = this._icons[3]
  }    

})
