export function nanoid(): string {
  return Math.random().toString(36).slice(2, 11)
}

export function now(): number {
  return Math.floor(Date.now() / 1000)
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
