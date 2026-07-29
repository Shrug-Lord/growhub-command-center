// Actuator string positions map to outlet IDs:
//   pos 0 = bit0 = Outlet 2 (GPIO 25)
//   pos 1 = bit1 = Outlet 3 (GPIO 26)
//   pos 2 = bit2 = Outlet 4 (GPIO 27)
//   pos 3 = bit3 = Outlet 1 (GPIO 33)
export function decodeRelayState(a = '') {
  return {
    o2: (a[0] ?? '0') === '1',
    o3: (a[1] ?? '0') === '1',
    o4: (a[2] ?? '0') === '1',
    o1: (a[3] ?? '0') === '1',
  }
}
