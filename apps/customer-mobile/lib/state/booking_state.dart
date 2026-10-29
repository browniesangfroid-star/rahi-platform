import 'package:flutter/foundation.dart';
import '../maps/maps_provider.dart';
import '../models/models.dart';
import '../services/ride_service.dart';

enum BookingStatus { idle, estimating, ready, requesting, requested, error }

/// Booking funnel state: service → pickup → destination → estimate →
/// customer offer → request. Every state has a UI: loading spinners,
/// error banners with retry, and no silent failures.
class BookingState extends ChangeNotifier {
  final RideService rides;
  final MapsProvider maps;
  BookingState(this.rides, this.maps);

  ServiceType service = ServiceType.car;
  Place? pickup;
  Place? destination;
  Estimate? estimate;
  int? customerOfferMinor;
  String paymentMethod = 'CASH';
  Map<String, dynamic>? deliveryDetails;
  BookingStatus status = BookingStatus.idle;
  String? error;
  String? requestId;

  bool get canEstimate => pickup != null && destination != null;
  bool get canRequest => status == BookingStatus.ready || status == BookingStatus.error;

  void setService(ServiceType value) {
    service = value;
    estimate = null;
    status = BookingStatus.idle;
    notifyListeners();
  }

  void setPickup(Place place) {
    pickup = place;
    notifyListeners();
  }

  void setDestination(Place place) {
    destination = place;
    notifyListeners();
  }

  /// Local preview first (map distance/ETA), then the server estimate.
  /// If the server is unreachable, the preview stays visible and the
  /// error explains the next step — no fake fare.
  Future<void> loadEstimate() async {
    if (!canEstimate) return;
    status = BookingStatus.estimating;
    error = null;
    notifyListeners();
    final p = pickup!;
    final d = destination!;
    final localKm = maps.distanceKm(p.point, d.point);
    final localEta = maps.etaMinutes(localKm, service);
    try {
      estimate = await rides.estimate(pickup: p, destination: d, service: service);
      status = BookingStatus.ready;
    } catch (e) {
      // Server estimate unavailable: keep a local distance/ETA
      // preview, but do NOT invent a fare.
      estimate = Estimate(
        distanceKm: localKm,
        durationMin: localEta,
        suggestedFareMinor: 0,
        currency: 'PKR',
        pricingMode: 'PENDING',
      );
      status = BookingStatus.error;
      error = 'Live fare is not available right now. '
          'Distance and time below are a map preview only — no fare is shown.';
    }
    notifyListeners();
  }

  Future<void> requestRide() async {
    if (!canEstimate) return;
    status = BookingStatus.requesting;
    error = null;
    notifyListeners();
    try {
      final result = await rides.requestRide(
        pickup: pickup!,
        destination: destination!,
        service: service,
        customerOfferMinor: customerOfferMinor,
        paymentMethod: paymentMethod,
        deliveryDetails: deliveryDetails,
      );
      requestId = result['id'] as String?;
      status = BookingStatus.requested;
    } catch (e) {
      status = BookingStatus.error;
      error = 'Could not send your request: $e. Check your connection and try again.';
    }
    notifyListeners();
  }

  void reset() {
    pickup = null;
    destination = null;
    estimate = null;
    customerOfferMinor = null;
    paymentMethod = 'CASH';
    deliveryDetails = null;
    requestId = null;
    status = BookingStatus.idle;
    error = null;
    notifyListeners();
  }
}
