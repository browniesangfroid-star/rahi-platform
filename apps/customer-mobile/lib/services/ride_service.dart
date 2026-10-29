import 'api_client.dart';
import '../models/models.dart';

/// Ride endpoints from docs/API-SPEC.md, live on the Render API.
/// The UI must never invent an estimate, a fare or a driver.
class RideService {
  final ApiClient api;
  RideService(this.api);

  Future<Estimate> estimate({
    required Place pickup,
    required Place destination,
    required ServiceType service,
  }) async {
    final data = await api.post('/rides/estimate', {
      'pickup': pickup.point.toJson(),
      'destination': destination.point.toJson(),
      'service': service.apiValue,
    });
    return Estimate.fromJson(data);
  }

  Future<Map<String, dynamic>> requestRide({
    required Place pickup,
    required Place destination,
    required ServiceType service,
    int? customerOfferMinor,
    String paymentMethod = 'CASH',
    Map<String, dynamic>? deliveryDetails,
  }) async {
    return api.post('/rides/request', {
      'pickup': pickup.point.toJson(),
      'destination': destination.point.toJson(),
      'service': service.apiValue,
      if (customerOfferMinor != null) 'customerOfferMinor': customerOfferMinor,
      'paymentMethod': paymentMethod,
      // Required for DELIVERY, rejected for other services.
      if (deliveryDetails != null) 'deliveryDetails': deliveryDetails,
    });
  }

  /// Trip endpoints. The pickup PIN arrives in the accept response
  /// (see the offers flow); regeneratePin is the recovery when the
  /// customer loses it.
  Future<Map<String, dynamic>> getTrip(String rideId) => api.get('/trips/$rideId');
  Future<Map<String, dynamic>> cancelTrip(String rideId, {String? reason}) =>
      api.post('/trips/$rideId/cancel', {if (reason != null) 'reason': reason});
  Future<Map<String, dynamic>> regeneratePin(String rideId) =>
      api.post('/trips/$rideId/regenerate-pin', {});

  /// Delivery recipient OTP: the customer regenerates it when the
  /// recipient lost it. The OTP itself is for the recipient to hand
  /// to the driver — it completes the delivery, never a plain trip.
  Future<Map<String, dynamic>> regenerateDeliveryOtp(String rideId) =>
      api.post('/trips/$rideId/delivery/regenerate-otp', {});
}
