export function getUtcMonthStart(reference = new Date()): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
}

export function wasCreatedThisUtcMonth(createdAt: Date, reference = new Date()): boolean {
  return createdAt.getTime() >= getUtcMonthStart(reference).getTime();
}
