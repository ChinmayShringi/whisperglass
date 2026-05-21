import type { HotkeyAction } from '../../shared/types'

export function nextPosition(
  current: [number, number],
  action: HotkeyAction,
  step: number,
): [number, number] {
  const [x, y] = current
  switch (action) {
    case 'move-up':
      return [x, y - step]
    case 'move-down':
      return [x, y + step]
    case 'move-left':
      return [x - step, y]
    case 'move-right':
      return [x + step, y]
    default:
      return [x, y]
  }
}
