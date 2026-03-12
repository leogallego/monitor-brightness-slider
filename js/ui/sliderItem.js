
import GObject from 'gi://GObject'
import St      from 'gi://St'

import {QuickSlider} from 'resource:///org/gnome/shell/ui/quickSettings.js'

// The generic slider item for this extension. It shows a monitor icon
// on the right to indicate that these sliders are for the DDC
// connection
export const MVSliderItem = GObject.registerClass(
class MVSliderItem extends QuickSlider {

  // icon: icon for the left side
  // extension: the extension object
  _init (icon, extension) {
    super._init({
      iconName: icon,
    })

    this._extension = extension

    // the pseudoButton is here to match the construction of the icon
    // button on the left side
    const pseudoButton = new St.Button({
      child: new St.Icon({
        iconName: 'video-display-symbolic',
      }),
      style_class: 'icon-button flat',
      reactive: false,
      can_focus: false,
      x_expand: false,
    })
    pseudoButton.remove_style_pseudo_class('insensitive')
    this.child.add_child(pseudoButton)

    this.slider.value = 0.5

  }

})
