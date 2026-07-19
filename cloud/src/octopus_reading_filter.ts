export interface ComparableOctopusReading {
  supplyPoint: string;
  observedAt: number;
  energyKwh: number;
}

export function changedOctopusReadings<T extends ComparableOctopusReading>(
  incoming: readonly T[],
  stored: readonly ComparableOctopusReading[],
): T[] {
  const existing = new Map<string, number>();
  for (const reading of stored) {
    existing.set(`${reading.supplyPoint}:${reading.observedAt}`, reading.energyKwh);
  }
  return incoming.filter(reading => existing.get(`${reading.supplyPoint}:${reading.observedAt}`) !== reading.energyKwh);
}
