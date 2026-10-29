import 'dart:math' as math;
import '../models/models.dart';

/// Map abstraction — the app never hardcodes a map vendor in screens.
/// v1 implementation is OpenStreetMap tiles (no API key) with a
/// haversine fallback for local distance display. Server estimates
/// remain authoritative for fares; this is only for the map preview.
abstract class MapsProvider {
  double distanceKm(GeoPoint a, GeoPoint b);
  int etaMinutes(double distanceKm, ServiceType service);
}

class OsmMapsProvider implements MapsProvider {
  @override
  double distanceKm(GeoPoint a, GeoPoint b) {
    const earthKm = 6371.0;
    final dLat = _rad(b.lat - a.lat);
    final dLng = _rad(b.lng - a.lng);
    final h = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_rad(a.lat)) * math.cos(_rad(b.lat)) * math.sin(dLng / 2) * math.sin(dLng / 2);
    return 2 * earthKm * math.asin(math.sqrt(h));
  }

  @override
  int etaMinutes(double distanceKm, ServiceType service) {
    final speedKmh = switch (service) {
      ServiceType.bike => 28.0,
      ServiceType.delivery => 28.0,
      ServiceType.car => 24.0,
    };
    return (distanceKm / speedKmh * 60).ceil();
  }

  double _rad(double degrees) => degrees * math.pi / 180;
}
