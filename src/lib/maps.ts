export function isApplePlatform(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return /iPad|iPhone|iPod/.test(userAgent);
}

export function buildMapsUrl({
  latitude,
  longitude,
  address,
  userAgent,
}: {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  userAgent: string | null;
}): string | null {
  const hasCoords = latitude != null && longitude != null;
  if (!hasCoords && !address) return null;

  const query = hasCoords ? `${latitude},${longitude}` : address!;

  if (isApplePlatform(userAgent)) {
    return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
