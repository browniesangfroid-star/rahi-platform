/** Haversine distance in km. Server-side distance for estimates;
 *  road-network routing replaces this when a MapsProvider is wired in
 *  Phase 9 (the fare formula itself does not change). */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthKm = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthKm * Math.asin(Math.sqrt(h));
}

export function etaMinutes(distanceKm: number, serviceCode: string): number {
  const speedKmh = serviceCode === 'BIKE' || serviceCode === 'DELIVERY' ? 28 : 24;
  return Math.ceil((distanceKm / speedKmh) * 60);
}
