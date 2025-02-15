<template>
  <v-row class="d-flex align-center justify-center">
    <v-col cols="auto">
      <v-btn v-tooltip="'Volume up'" @click="volumeDown">
        <v-icon>mdi-volume-minus</v-icon>
      </v-btn>
      <v-btn v-tooltip="'Volume down'" @click="volumeUp">
        <v-icon>mdi-volume-plus</v-icon>
      </v-btn>
      <v-btn v-tooltip="'Rotate'" @click="rotateDevice">
        <v-icon>mdi-phone-rotate-landscape</v-icon>
      </v-btn>
      <v-btn v-tooltip="'AppSwitch'" @click="clickAppSwitch">
        <v-icon>mdi-apps-box</v-icon>
      </v-btn>
      <v-btn v-tooltip="'Home'" @click="clickHome">
        <v-icon>mdi-home-circle</v-icon>
      </v-btn>
      <v-btn v-tooltip="'Back'" @click="clickBack">
        <v-icon>mdi-arrow-left</v-icon>
      </v-btn>
      <v-btn v-tooltip="'ShowKeyboard'" @click="showKeyboard">
        <v-icon>mdi-keyboard</v-icon>
      </v-btn>
      <v-btn v-tooltip="'Fullscreen'" @click="enterFullscreen">
        <v-icon>mdi-fullscreen</v-icon>
      </v-btn>
      <!-- <v-btn @click="rotateVideoLeft">
              <v-icon>mdi-rotate-left-variant</v-icon>
            </v-btn>
            <v-btn @click="rotateVideoRight">
              <v-icon>mdi-rotate-right-variant</v-icon>
            </v-btn>
            <v-btn @click="screenOff">
              <v-icon>mdi-monitor-off</v-icon>
            </v-btn>
            <v-btn @click="screenOn">
              <v-icon>mdi-monitor</v-icon>
            </v-btn> -->
    </v-col>
    <v-col cols="auto">
      <v-chip color="green">{{ framesRendered }}</v-chip>
      <v-chip color="red">{{ framesSkipped }}</v-chip>
    </v-col>
  </v-row>
</template>

<script setup>
import { AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy'
import { useAdbStore } from '@/store/adb'

const adbStore = useAdbStore()

const props = defineProps([
  'sendEvent',
  'fullscreen',
  'framesRendered',
  'framesSkipped'
])

const volumeUp = () => {
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Down,
      keyCode: AndroidKeyCode.VolumeUp,
      repeat: 0,
      metaState: 0,
    },
  })
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Up,
      keyCode: AndroidKeyCode.VolumeUp,
      repeat: 0,
      metaState: 0,
    },
  })
}

const volumeDown = () => {
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Down,
      keyCode: AndroidKeyCode.VolumeDown,
      repeat: 0,
      metaState: 0,
    },
  })
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Up,
      keyCode: AndroidKeyCode.VolumeDown,
      repeat: 0,
      metaState: 0,
    },
  })
}

const clickAppSwitch = () => {
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Down,
      keyCode: AndroidKeyCode.AndroidAppSwitch,
      repeat: 0,
      metaState: 0,
    },
  })
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Up,
      keyCode: AndroidKeyCode.AndroidAppSwitch,
      repeat: 0,
      metaState: 0,
    },
  })
}

const clickHome = () => {
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Down,
      keyCode: AndroidKeyCode.AndroidHome,
      repeat: 0,
      metaState: 0,
    },
  })
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Up,
      keyCode: AndroidKeyCode.AndroidHome,
      repeat: 0,
      metaState: 0,
    },
  })
}

const clickBack = () => {
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Down,
      keyCode: AndroidKeyCode.AndroidBack,
      repeat: 0,
      metaState: 0,
    },
  })
  props.sendEvent({
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Up,
      keyCode: AndroidKeyCode.AndroidBack,
      repeat: 0,
      metaState: 0,
    },
  })
}

const showKeyboard = () => {
  document.getElementById('hiddenInput').focus();
}

const enterFullscreen = () => {
  fullscreen.focus()
  fullscreen.requestFullscreen()
}

function fullscreenchangeHandler(event) {
  if (document.fullscreenElement) {
    console.log(`Element: ${document.fullscreenElement.id} entered fullscreen mode.`);
    fullscreen.children[0].children[0].style.height = "100%";
  } else {
    console.log("Leaving fullscreen mode.");
    fullscreen.children[0].children[0].style.height = "85vh";
  }
}

document.addEventListener("fullscreenchange", fullscreenchangeHandler);

const rotateDevice = () => {
  props.sendEvent({
    cmd: 'rotateDevice',
  })
}

const rebootDevice = () => {
  props.sendEvent({
    cmd: 'rebootDevice',
  })
}

const rotateVideoLeft = () => {
  fullscreen.focus()

  rotation.value -= 1
  if (rotation.value < 0) {
    rotation.value = 3
  }
}

const rotateVideoRight = () => {
  fullscreen.focus()
  rotation.value = (rotation.value + 1) & 3
}

const screenOff = () => {
  sendEvent({
    cmd: 'setScreenPowerMode',
    payload: AndroidScreenPowerMode.Off,
  })
}

const screenOn = () => {
  sendEvent({
    cmd: 'setScreenPowerMode',
    payload: AndroidScreenPowerMode.Normal,
  })
}
</script>
