export function formatDuration(secs: number) {
  if (secs <= 0) return ""
  const round1 = (value: number) => String(Math.round(value * 10) / 10)
  if (secs < 60) return `${round1(secs)}s`
  if (secs < 3600) {
    const mins = Math.floor(secs / 60)
    const remaining = round1(secs % 60)
    return remaining === "0" ? `${mins}m` : `${mins}m ${remaining}s`
  }
  if (secs < 86400) {
    const hours = Math.floor(secs / 3600)
    const remaining = Math.floor((secs % 3600) / 60)
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
  }
  if (secs < 604800) {
    const days = Math.floor(secs / 86400)
    return days === 1 ? "~1 day" : `~${days} days`
  }
  const weeks = Math.floor(secs / 604800)
  return weeks === 1 ? "~1 week" : `~${weeks} weeks`
}
