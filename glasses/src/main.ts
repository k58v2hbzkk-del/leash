import { connect } from './api'
import { mountPhone, setPhoneState, setPhoneOnline } from './phone'
import { startGlasses, setGlassesState, setOnline, onGlassesEvent } from './glasses'

mountPhone()
// The glasses side only exists inside the Even app (or the simulator); in a plain browser the bridge
// never arrives and you just get the phone view.
const glasses = startGlasses().then(() => true).catch((e) => (console.warn('glasses unavailable', e), false))

connect(
  (s) => {
    setPhoneState(s)
    glasses.then((ok) => ok && setGlassesState(s))
  },
  (e) => glasses.then((ok) => ok && onGlassesEvent(e)),
  (ok) => {
    setPhoneOnline(ok)
    glasses.then((g) => g && setOnline(ok))
  },
)
