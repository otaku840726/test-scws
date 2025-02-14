<!-- <template>
  <v-container class="fill-height" :style="{
    'max-width': '100%'
  }">
    <v-responsive class="align-center text-center fill-height">
      <v-row class="d-flex align-center justify-center">
        <v-col id="temp" :style="{
          display: 'none',
          flex: '1 0 100%',
          'max-width': '350px'
        }">
          <div class="fullscreen" :style="{
            width: '100%',
            height: '100%',
            display: 'flex',
            'flex-direction': 'column',
          }" @keydown="handleKeyDown" @keyup="handleKeyUp">
            <div class="videocanvas" :style="{
              transform: `translate(${(rotatedWidth - width) / 2}px, ${(rotatedHeight - height) / 2}px) rotate(${rotation * 90}deg)`,
            }" @pointerdown="handlePointerDown" @pointermove="handlePointerMove" @pointerup="handlePointerUp"
              @pointercancel="handlePointerUp" @pointerleave="handlePointerLeave" @contextmenu="handleContextMenu">
            </div>
          </div>
        </v-col>
      </v-row>
    </v-responsive>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router';
import {
  ScrcpyVideoCodecId,
  ScrcpyAudioCodec,
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  ScrcpyPointerId,
  ScrcpyHoverHelper,
  ScrcpyControlMessageType,
} from '@yume-chan/scrcpy'
import { TinyH264Decoder } from '@yume-chan/scrcpy-decoder-tinyh264'
import { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs'
import {
  Float32PcmPlayer,
  Float32PlanerPcmPlayer,
  Int16PcmPlayer,
} from '@yume-chan/pcm-player'
import { ReadableStream, WritableStream } from '@yume-chan/stream-extra'
import {
  AacDecodeStream,
  OpusDecodeStream,
} from '@/utils/audio-decode-stream'
import { Packr, Unpackr } from 'msgpackr'
import { useAdbStore } from '@/store/adb'
import { useFileStore } from '@/store/file'
import { streamingService } from '@/services/stream/streaming-service'
import FileList from '@/components/file/FileList'
import DeviceActions from '@/components/device/DeviceActions'
import DeviceControls from '@/components/device/DeviceControls'
import { mapClientToDevicePosition } from '@/utils/mapClientToDevicePosition'
import {
  PACK_OPTIONS,
  DEAULT_BIT_RATE,
  DEAULT_MAX_FPS,
} from '@/utils/constants'

const MOUSE_EVENT_BUTTON_TO_ANDROID_BUTTON = [
  AndroidMotionEventButton.Primary,
  AndroidMotionEventButton.Tertiary,
  AndroidMotionEventButton.Secondary,
  AndroidMotionEventButton.Back,
  AndroidMotionEventButton.Forward,
]
const packer = new Packr(PACK_OPTIONS)
const unpacker = new Unpackr(PACK_OPTIONS)

const adbStore = useAdbStore()
const fileStore = useFileStore()

let container = {}
let fullscreen = {}
let renderer = {}
let ws = {}

let abortControllerArr = []
let decoderArr = []
let videoController = {}
// let audioController
let framesInterval

const hoverHelper = new ScrcpyHoverHelper()
const width = ref(adbStore.displaySize?.width || 0)
const height = ref(adbStore.displaySize?.height || 0)
const rotation = ref(0)

const framesRendered = ref(0)
const framesSkipped = ref(0)

const isStreaming = ref(false)
const isWsOpen = ref(false)
const controlLeft = ref(false)
const controlRight = ref(false)
const shiftLeft = ref(false)
const shiftRight = ref(false)
const altLeft = ref(false)
const altRight = ref(false)
const metaLeft = ref(false)
const metaRight = ref(false)
const capsLock = ref(false)
const numLock = ref(true)
const keys = new Set()

const rotatedWidth = computed(() => {
  return rotation.value & 1 ? height.value : width.value
})
const rotatedHeight = computed(() => {
  return rotation.value & 1 ? width.value : height.value
})

const route = useRoute();
let maxFps = 30;
let bitRate = 1;
if (route.query.maxFps) {
  maxFps = route.query.maxFps
}
if (route.query.bitRate) {
  bitRate = route.query.bitRate
}

onMounted(async () => {
  // container = document.getElementsByClassName('video-canvas')
  // fullscreen = document.getElementsByClassName('fullscreen')

  await Promise.all([
    adbStore.metainfo(),
    fileStore.getUplaods(),
    fileStore.getApps(),
  ])
  // await start({ device: adbStore.devices[0], maxFps: DEAULT_MAX_FPS, bitRate: DEAULT_BIT_RATE })
  const promises = [];
  for (const device of adbStore.devices) {
    promises.push(start({ device: device, maxFps: maxFps, bitRate: bitRate }))
  }
  await Promise.all(promises)
  .then(value => {
  })
  .catch(err => {
    console.log(err)
  })
})

const setModifier = (keyCode, value) => {
  switch (keyCode) {
    case AndroidKeyCode.ControlLeft:
      controlLeft.value = value
      break
    case AndroidKeyCode.ControlRight:
      controlRight.value = value
      break
    case AndroidKeyCode.ShiftLeft:
      shiftLeft.value = value
      break
    case AndroidKeyCode.ShiftRight:
      shiftRight.value = value
      break
    case AndroidKeyCode.AltLeft:
      altLeft.value = value
      break
    case AndroidKeyCode.AltRight:
      altRight.value = value
      break
    case AndroidKeyCode.MetaLeft:
      metaLeft.value = value
      break
    case AndroidKeyCode.MetaRight:
      metaRight.value = value
      break
    case AndroidKeyCode.CapsLock:
      if (value) {
        capsLock.value = !capsLock.value
      }
      break
    case AndroidKeyCode.NumLock:
      if (value) {
        numLock.value = !numLock.value
      }
      break
  }
}

const getMetaState = () => {
  let metaState = 0
  if (altLeft.value) {
    metaState |= AndroidKeyEventMeta.AltOn | AndroidKeyEventMeta.AltLeftOn
  }
  if (altRight.value) {
    metaState |= AndroidKeyEventMeta.AltOn | AndroidKeyEventMeta.AltRightOn
  }
  if (shiftLeft.value) {
    metaState |= AndroidKeyEventMeta.ShiftOn | AndroidKeyEventMeta.ShiftLeftOn
  }
  if (shiftRight.value) {
    metaState |=
      AndroidKeyEventMeta.ShiftOn | AndroidKeyEventMeta.ShiftRightOn
  }
  if (controlLeft.value) {
    metaState |= AndroidKeyEventMeta.CtrlOn | AndroidKeyEventMeta.CtrlLeftOn
  }
  if (controlRight.value) {
    metaState |= AndroidKeyEventMeta.CtrlOn | AndroidKeyEventMeta.CtrlRightOn
  }
  if (metaLeft.value) {
    metaState |= AndroidKeyEventMeta.MetaOn | AndroidKeyEventMeta.MetaLeftOn
  }
  if (metaRight.value) {
    metaState |= AndroidKeyEventMeta.MetaOn | AndroidKeyEventMeta.MetaRightOn
  }
  if (capsLock.value) {
    metaState |= AndroidKeyEventMeta.CapsLockOn
  }
  if (numLock.value) {
    metaState |= AndroidKeyEventMeta.NumLockOn
  }
  return metaState
}

const down = async (serial, key) => {
  const keyCode = AndroidKeyCode[key]
  if (!keyCode) {
    console.log('unknown key')
    return
  }

  setModifier(keyCode, true)
  keys.add(keyCode)

  const payload = {
    action: AndroidKeyEventAction.Down,
    keyCode,
    metaState: getMetaState(),
    repeat: 0,
  }
  send(serial, {
    cmd: 'injectKeyCode',
    payload,
  })
  // await this.client.controlMessageWriter?.injectKeyCode();
}

const up = async (serial, key) => {
  const keyCode = AndroidKeyCode[key]
  if (!keyCode) {
    return
  }

  setModifier(keyCode, false)
  keys.delete(keyCode)

  send(serial, {
    cmd: 'injectKeyCode',
    payload: {
      action: AndroidKeyEventAction.Up,
      keyCode,
      metaState: getMetaState(),
      repeat: 0,
    },
  })
}

const reset = async () => {
  controlLeft.value = false
  controlRight.value = false
  shiftLeft.value = false
  shiftRight.value = false
  altLeft.value = false
  altRight.value = false
  metaLeft.value = false
  metaRight.value = false
  for (const key of keys) {
    up(AndroidKeyCode[key])
  }
  keys.clear()
}

const send = (serial, message) => {
  if (ws[serial]) {
    const record = packer.pack(message)
    ws[serial].send(record)
  }
}

const dispose = async () => {
  if (abortControllerArr.length > 0) {
    for (const abortController of abortControllerArr) {
      await abortController.abort()
    }
    abortControllerArr = []
    console.log('abortController.aborted')
  }
  if (decoderArr.length > 0) {
    for (const decoder of decoderArr) {
      await decoder.dispose()
    }
    decoderArr = []
    console.log('decoder disposed')
  }
  
  if (Object.keys(ws).length > 0) {
    for (const serial in ws) {
      await ws[serial].close()
    }
    ws = {}
    console.log('ws closed')
  }
  if (framesInterval) {
    clearTimeout(framesInterval)
    framesInterval = undefined
  }
  const elements = document.getElementsByClassName('device');
  while(elements.length > 0){
    elements[0].parentNode.removeChild(elements[0]);
  }
}

const start = async ({ device, maxFps, bitRate }) => {
  // await dispose()

  const abortController = new AbortController()
  abortControllerArr.push(abortController)
  isStreaming.value = true


  const encoder = device.encoders[0]
  encoder.decoder = 'WebCodecs'
  let decoder

  if (['off', 'raw'].includes(encoder.codec)) {
    audioPlayer = new Int16PcmPlayer(48000, 2)
  } else if (['aac'].includes(encoder.codec)) {
    audioPlayer = new Float32PlanerPcmPlayer(48000, 2)
  } else if (['opus'].includes(encoder.codec)) {
    audioPlayer = new Float32PcmPlayer(48000, 2)
  }
  if (['off', 'TinyH264'].includes(encoder.decoder)) {
    decoder = new TinyH264Decoder()
  } else if (['WebCodecs'].includes(encoder.decoder)) {
    let codec
    switch (encoder.codec) {
      case 'h264': {
        codec = ScrcpyVideoCodecId.H264
        break
      }
      case 'h265': {
        codec = ScrcpyVideoCodecId.H265
        break
      }
      case 'av1': {
        codec = ScrcpyVideoCodecId.AV1
        break
      }
    }
    decoder = new WebCodecsVideoDecoder(codec, false) //
  }
  decoderArr.push(decoder)
  renderer[device.serial] = decoder.renderer
  renderer[device.serial].dataset.serial = device.serial
  renderer[device.serial].style.maxWidth = '100%'
  renderer[device.serial].style.maxHeight = '100%'
  renderer[device.serial].style.touchAction = 'none'
  renderer[device.serial].style.outline = 'none'
  let tempContainer = document.getElementById('temp')
  let newContainer = tempContainer.cloneNode(true)
  newContainer.setAttribute('id', device.serial);
  newContainer.style.display = "block"
  newContainer.classList.add('device');
  let before = tempContainer.nextSibling;
  tempContainer.parentNode.insertBefore(newContainer, before);
  newContainer.querySelector('.videocanvas').appendChild(renderer[device.serial])
  decoder.sizeChanged((size) => {
    width.value = size.width
    height.value = size.height
    console.log(`RESIZE: width=${size.width}, height=${size.height}`)
  })

  let videoCanvas = newContainer.querySelector('.videocanvas')
  videoCanvas.dataset.serial = device.serial
  videoCanvas.addEventListener('pointerdown', handlePointerDown)
  videoCanvas.addEventListener('pointermove', handlePointerMove)
  videoCanvas.addEventListener('pointerup', handlePointerUp)
  videoCanvas.addEventListener('pointercancel', handlePointerUp)
  videoCanvas.addEventListener('pointerleave', handlePointerLeave)
  videoCanvas.addEventListener('contextmenu', handleContextMenu)

  fullscreen[device.serial] = newContainer.querySelector('.fullscreen')
  fullscreen[device.serial].addEventListener('wheel', handleWheel, {
    passive: false,
  })
  fullscreen[device.serial].tabIndex = 0

  renderer[device.serial].setAttribute('aria-label', 'Device Screen')

  new ReadableStream({
    start(controller) {
      videoController[device.serial] = controller
    },
  })
    .pipeTo(decoder.writable, {
      signal: abortController.signal,
    })
    .catch((e) => {
      if (abortController.signal.aborted) {
        return
      }
    })
  ws[device.serial] = await streamingService.init({
    device: device.serial,
    audio: false,
    audioCodec: undefined,
    audioEncoder: undefined,
    video: true,
    videoCodec: device.encoders[0].codec,
    videoEncoder: device.encoders[0].name,
    videoBitRate: bitRate,
    maxFps: maxFps,
    onopen: (ws, id, evt) => {
      console.log(`ID=${id} CONNECTED`)
      isWsOpen.value = true
    },
    onclose: (ws, id, evt) => {
      console.log(`ID=${id} DISCONNECTED`)
      isWsOpen.value = false
      // dispose();
    },
    onmessage: (ws, id, evt) => {
      const record = unpacker.unpack(evt.data)
      if (record.media === 'video') {
        try {
          videoController[device.serial].enqueue(record.packet)
        } catch (err) {
          console.log(err)
        }
      }
    },
    onerror: (ws, id, evt) => {
      console.log(`ID=${id} ERROR=${evt.data}`)
    },
  })

  framesInterval = setInterval(() => {
    framesRendered.value = decoder.framesRendered
    framesSkipped.value = decoder.framesSkipped
  }, 1000)
}

document.addEventListener('visibilitychange', async function() {
  if (document.visibilityState === 'hidden') {
    await dispose()
  } else {
    await Promise.all([
    adbStore.metainfo(),
    fileStore.getUplaods(),
    fileStore.getApps(),
  ])
  // await start({ device: adbStore.devices[0], maxFps: DEAULT_MAX_FPS, bitRate: DEAULT_BIT_RATE })
  const promises = [];
  for (const device of adbStore.devices) {
    promises.push(start({ device: device, maxFps: maxFps, bitRate: bitRate }))
  }
  await Promise.all(promises)
  .then(value => {
  })
  .catch(err => {
    console.log(err)
  })
  }
});


const handleWheel = (e) => {
  fullscreen[e.target.dataset.serial].focus()
  e.preventDefault()
  e.stopPropagation()

  const { x, y } = mapClientToDevicePosition({
    clientX: e.clientX,
    clientY: e.clientY,
    clientRect: renderer[e.target.dataset.serial].getBoundingClientRect(),
    rotation: rotation.value,
    width: width.value,
    height: height.value,
  })

  send(e.target.dataset.serial, {
    cmd: 'injectScroll',
    payload: {
      screenWidth: width.value,
      screenHeight: height.value,
      pointerX: x,
      pointerY: y,
      scrollX: -e.deltaX / 100,
      scrollY: -e.deltaY / 100,
      buttons: 0,
    },
  })
}

const injectTouch = (action, e) => {
  const { pointerType } = e
  let pointerId
  if (pointerType === 'mouse') {
    // Android 13 has bug with mouse injection
    // https://github.com/Genymobile/scrcpy/issues/3708
    pointerId = ScrcpyPointerId.Finger
  } else {
    pointerId = BigInt(e.pointerId)
  }

  const { x, y } = mapClientToDevicePosition({
    clientX: e.clientX,
    clientY: e.clientY,
    clientRect: renderer[e.target.dataset.serial].getBoundingClientRect(),
    rotation: rotation.value,
    width: width.value,
    height: height.value,
  })

  const messages = hoverHelper.process({
    action,
    pointerId,
    screenWidth: width.value,
    screenHeight: height.value,
    pointerX: x,
    pointerY: y,
    pressure: e.pressure,
    actionButton: MOUSE_EVENT_BUTTON_TO_ANDROID_BUTTON[e.button],
    // `MouseEvent.buttons` has the same order as Android `MotionEvent`
    buttons: e.buttons,
  })
  for (const message of messages) {
    send(e.target.dataset.serial, {
      cmd: 'injectTouch',
      payload: message,
    })
    // STATE.client.controlMessageWriter!.injectTouch(message);
  }
}

const handleKeyDown = (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (e.ctrlKey && e.key === 'v') {
    handleClipboardPaste(e)
  } else {
    down(e.target.dataset.serial, e.code)
  }
}

const handleKeyUp = async (e) => {
  e.preventDefault()
  e.stopPropagation()
  up(e.target.dataset.serial, e.code)
}

const handleClipboardPaste = async (e) => {
  const clipboardText = await navigator.clipboard.readText()
  if (clipboardText)
    send(e.target.dataset.serial, {
      cmd: 'clipboardPaste',
      payload: {
        type: ScrcpyControlMessageType.SetClipboard,
        sequence: BigInt('12345'), // Use BigInt for sequence
        paste: true,
        length: clipboardText.length, // Content length
        content: clipboardText, // Clipboard content
      },
    })
}

const handlePointerDown = (e) => {
  fullscreen[e.target.dataset.serial].focus()
  e.preventDefault()
  e.stopPropagation()

  e.currentTarget.setPointerCapture(e.pointerId)
  injectTouch(AndroidMotionEventAction.Down, e)
}

const handlePointerMove = (e) => {
  e.preventDefault()
  e.stopPropagation()
  injectTouch(
    e.buttons === 0
      ? AndroidMotionEventAction.HoverMove
      : AndroidMotionEventAction.Move,
    e,
  )
}

const handlePointerUp = (e) => {
  e.preventDefault()
  e.stopPropagation()
  injectTouch(AndroidMotionEventAction.Up, e)
}

const handlePointerLeave = (e) => {
  e.preventDefault()
  e.stopPropagation()
  // Because pointer capture on pointer down, this event only happens for hovering mouse and pen.
  // Release the injected pointer, otherwise it will stuck at the last position.
  injectTouch(AndroidMotionEventAction.HoverExit, e)
  injectTouch(AndroidMotionEventAction.Up, e)
}

const handleContextMenu = (e) => {
  e.preventDefault()
}



</script> -->
