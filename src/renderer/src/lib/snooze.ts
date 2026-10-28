// Preset wake times are presentation-owned: what "Tomorrow" means is a UI
// decision, while main only validates that the time is a finite future
// moment. Snoozes restore while Mailsy is running; if the app is closed at
// the wake time, the thread returns on the next launch, Mailspring-style.
export interface SnoozePreset {
  key: string
  label: string
  at: () => number
}

function atNextWeekday(weekday: number, hour: number): number {
  const when = new Date()
  when.setHours(hour, 0, 0, 0)
  // The next such weekday, never today: a snooze always must land in the
  // future for the boundary to take it.
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
  // Later this week reaches Friday morning; Next week the Monday one after.
  { key: 'later-this-week', label: 'Later this week', at: () => atNextWeekday(5, 8) },
  { key: 'next-week', label: 'Next week', at: () => atNextWeekday(1, 8) }
]
