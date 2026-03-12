
import GObject from 'gi://GObject'

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'

import {MVSliderItem} from './sliderItem.js'

// Brightness slider
export const MVBrightnessItem = GObject.registerClass(
class MVBrightnessItem extends MVSliderItem {

  _init (extension) {
    super._init('display-brightness-symbolic', extension)

    this._sliderChangedSignal = this.slider.connect(
      'notify::value', this._sliderChanged.bind(this))
    this.slider.accessible_name = _('Brightness')
  }

  _sliderChanged () {
    const percent = this.slider.value * 100
    this._extension?.setBrightness(percent).catch(e => console.error(e))
  }

  // method to change the slider without triggering the value changed
  // signals
  _changeSlider (percent) {
    this.slider.block_signal_handler(this._sliderChangedSignal)
    this.slider.value = percent / 100
    this.slider.unblock_signal_handler(this._sliderChangedSignal)
  }

})
