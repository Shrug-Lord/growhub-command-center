export function toDisplayTemp(c, unit) {
  if (c == null) return null
  return unit === 'F' ? +((c * 9) / 5 + 32).toFixed(1) : +parseFloat(c).toFixed(1)
}

export function fromDisplayTemp(v, unit) {
  if (v == null || v === '') return v
  return unit === 'F' ? +(((v - 32) * 5) / 9).toFixed(2) : +v
}
