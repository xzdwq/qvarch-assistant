/** ISO dates of git (`%aI`) compare as text — the earliest / latest of a non-empty list. */

export function earliestDate<T>(items: T[], dateOf: (item: T) => string): string {
  return items.reduce((min, item) => (dateOf(item) < min ? dateOf(item) : min), dateOf(items[0]));
}

export function latestDate<T>(items: T[], dateOf: (item: T) => string): string {
  return items.reduce((max, item) => (dateOf(item) > max ? dateOf(item) : max), dateOf(items[0]));
}
