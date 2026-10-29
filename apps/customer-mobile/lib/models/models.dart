/// Typed models matching docs/API-SPEC.md. Field names follow the API
/// contract; the server remains the source of truth for fares.

enum ServiceType { car, bike, delivery }

extension ServiceTypeLabel on ServiceType {
  String get apiValue => switch (this) {
        ServiceType.car => 'CAR',
        ServiceType.bike => 'BIKE',
        ServiceType.delivery => 'DELIVERY',
      };
  String get label => switch (this) {
        ServiceType.car => 'Car',
        ServiceType.bike => 'Bike',
        ServiceType.delivery => 'Delivery',
      };
}

class GeoPoint {
  final double lat;
  final double lng;
  const GeoPoint(this.lat, this.lng);
  Map<String, dynamic> toJson() => {'lat': lat, 'lng': lng};
  factory GeoPoint.fromJson(Map<String, dynamic> json) =>
      GeoPoint((json['lat'] as num).toDouble(), (json['lng'] as num).toDouble());
}

class Place {
  final String label;
  final GeoPoint point;
  const Place(this.label, this.point);
}

class Estimate {
  final double distanceKm;
  final int durationMin;
  final int suggestedFareMinor;
  final String currency;
  final String pricingMode;
  const Estimate({
    required this.distanceKm,
    required this.durationMin,
    required this.suggestedFareMinor,
    required this.currency,
    required this.pricingMode,
  });
  factory Estimate.fromJson(Map<String, dynamic> json) => Estimate(
        distanceKm: (json['distanceKm'] as num?)?.toDouble() ?? 0,
        durationMin: (json['durationMin'] as num?)?.toInt() ?? 0,
        suggestedFareMinor: (json['suggestedFareMinor'] as num?)?.toInt() ?? 0,
        currency: json['currency'] as String? ?? 'PKR',
        pricingMode: json['pricingMode'] as String? ?? 'NEGOTIATION',
      );
}

class UserProfile {
  final String id;
  final String? phone;
  final String? email;
  final String firstName;
  final String lastName;
  final List<String> roles;
  const UserProfile({
    required this.id,
    required this.phone,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.roles,
  });
  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: json['id'] as String,
        phone: json['phone'] as String?,
        email: json['email'] as String?,
        firstName: json['firstName'] as String? ?? '',
        lastName: json['lastName'] as String? ?? '',
        roles: (json['roles'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      );
  String get displayName {
    final name = '$firstName $lastName'.trim();
    return name.isEmpty ? (phone ?? email ?? 'Rahi user') : name;
  }
}
