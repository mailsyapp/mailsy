export interface SnoozePreset {
  key: string
  label: string
  at: () => number
}

function atNextWeekday(weekday: number, hour: number): number {
  const when = new Date()
  when.setHours(hour, 0, 0, 0)
  const days = (weekday - when.getDay() + 7) % 7 || 7
  when.setDate(when.getDate() + days)
  return when.getTime()
}

function atTomorrow(hour: number): number {
  const when = new Date()
  when.setDate(when.getDate() + 1)
  when.setHours(hour, 0, 0, 0)
  return when.getTime()
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { key: 'tomorrow', label: 'Tomorrow', at: () => atTomorrow(8) },
  { key: 'later-this-week', label: 'Later this week', at: () => atNextWeekday(5, 8) },
  { key: 'next-week', label: 'Next week', at: () => atNextWeekday(1, 8) }
]
