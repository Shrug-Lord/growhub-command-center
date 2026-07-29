export function reportedOrExisting(reported, existing, key, fallback = null) {
  if (reported && Object.prototype.hasOwnProperty.call(reported, key)) {
    return reported[key]
  }
  if (existing && Object.prototype.hasOwnProperty.call(existing, key)) {
    return existing[key]
  }
  return fallback
}
