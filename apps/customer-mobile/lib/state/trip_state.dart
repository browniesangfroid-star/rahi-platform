import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/models.dart';
import '../services/ride_service.dart';
import '../services/support_service.dart';
import '../services/tracking_service.dart';

/// Live-trip state for the customer app.
///
/// The active ride survives app restarts: the ride id, pickup PIN and
/// (for delivery) recipient OTP are kept in secure storage and restored
/// on launch, so a customer never loses a trip by closing the app.
/// Status is polled every 10 seconds and driver positions stream over
/// the socket; the server stays authoritative for every transition.
class TripState extends ChangeNotifier {
  final RideService rides;
  final SupportService support;
  final TrackingService tracking;
  TripState(this.rides, this.support, this.tracking);

  static const _rideKey = 'rahi_active_ride';
  static const _pinKey = 'rahi_pickup_pin';
  static const _deliveryOtpKey = 'rahi_delivery_otp';
  final _storage = const FlutterSecureStorage();

  String? activeRideId;
  String? pickupPin;
  String? deliveryOtp;
  Map<String, dynamic>? trip;
  GeoPoint? driverLocation;
  String? error;
  String? lastShareLink;
  bool busy = false;
  Timer? _poll;

  String get status => (trip?['status'] as String?) ?? 'UNKNOWN';

  bool get isTerminal =>
      status == 'COMPLETED' || status.startsWith('CANCELLED');

  String get statusLabel => status.replaceAll('_', ' ');

  Future<void> restore() async {
    activeRideId = await _storage.read(key: _rideKey);
    pickupPin = await _storage.read(key: _pinKey);
    deliveryOtp = await _storage.read(key: _deliveryOtpKey);
    if (activeRideId != null) {
      await refresh();
      if (!isTerminal) _startPolling();
    }
    notifyListeners();
  }

  /// Called with the accept response: the ride id, the pickup PIN
  /// (plaintext exactly once) and, for delivery, the recipient OTP.
  Future<void> startFromAccept(Map<String, dynamic> acceptData) async {
    final ride = acceptData['ride'] as Map<String, dynamic>?;
    activeRideId = (ride?['id'] as String?) ??
        (acceptData['rideId'] as String?) ??
        (acceptData['id'] as String?);
    pickupPin = acceptData['pin'] as String?;
    deliveryOtp = acceptData['deliveryOtp'] as String?;
    if (activeRideId != null) {
      await _storage.write(key: _rideKey, value: activeRideId!);
    }
    if (pickupPin != null) {
      await _storage.write(key: _pinKey, value: pickupPin!);
    }
    if (deliveryOtp != null) {
      await _storage.write(key: _deliveryOtpKey, value: deliveryOtp!);
    }
    await refresh();
    _startPolling();
  }

  void _startPolling() {
    _poll?.cancel();
    tracking.disconnect();
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => refresh());
    if (activeRideId != null) {
      tracking.connect(activeRideId!, (update) {
        final lat = (update['lat'] as num?)?.toDouble() ??
            ((update['location'] as Map?)?['lat'] as num?)?.toDouble();
        final lng = (update['lng'] as num?)?.toDouble() ??
            ((update['location'] as Map?)?['lng'] as num?)?.toDouble();
        if (lat != null && lng != null) {
          driverLocation = GeoPoint(lat, lng);
          notifyListeners();
        }
      });
    }
  }

  void _stopPolling() {
    _poll?.cancel();
    _poll = null;
    tracking.disconnect();
  }

  Future<void> refresh() async {
    if (activeRideId == null) return;
    try {
      trip = await rides.getTrip(activeRideId!);
      error = null;
      if (isTerminal) _stopPolling();
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  Future<void> cancelTrip({String? reason}) async {
    if (activeRideId == null) return;
    busy = true;
    notifyListeners();
    try {
      trip = await rides.cancelTrip(activeRideId!, reason: reason);
      error = null;
      _stopPolling();
    } catch (e) {
      error = e.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> sos({String? note}) async {
    if (activeRideId == null) return;
    try {
      await support.sos(activeRideId!, note: note);
      error = null;
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  Future<void> rate(int stars, {String? comment, String? reportReason}) async {
    if (activeRideId == null) return;
    busy = true;
    notifyListeners();
    try {
      await support.rateRide(activeRideId!,
          stars: stars, comment: comment, reportReason: reportReason);
      error = null;
      await refresh();
    } catch (e) {
      error = e.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> createShareLink({int ttlMinutes = 60}) async {
    if (activeRideId == null) return;
    try {
      final data =
          await support.createShareLink(activeRideId!, ttlMinutes: ttlMinutes);
      lastShareLink = (data['url'] as String?) ??
          (data['shareUrl'] as String?) ??
          (data['token'] as String?);
      error = null;
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  Future<void> regeneratePin() async {
    if (activeRideId == null) return;
    try {
      final data = await rides.regeneratePin(activeRideId!);
      pickupPin = data['pin'] as String?;
      if (pickupPin != null) {
        await _storage.write(key: _pinKey, value: pickupPin!);
      }
      error = null;
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  Future<void> regenerateDeliveryOtp() async {
    if (activeRideId == null) return;
    try {
      final data = await rides.regenerateDeliveryOtp(activeRideId!);
      deliveryOtp = (data['otp'] as String?) ?? (data['deliveryOtp'] as String?);
      if (deliveryOtp != null) {
        await _storage.write(key: _deliveryOtpKey, value: deliveryOtp!);
      }
      error = null;
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  /// Clears the trip only after it ended (completed/cancelled) — the
  /// customer explicitly closes it from the trip screen.
  Future<void> clearTrip() async {
    _stopPolling();
    activeRideId = null;
    pickupPin = null;
    deliveryOtp = null;
    trip = null;
    driverLocation = null;
    lastShareLink = null;
    await _storage.delete(key: _rideKey);
    await _storage.delete(key: _pinKey);
    await _storage.delete(key: _deliveryOtpKey);
    notifyListeners();
  }

  @override
  void dispose() {
    _stopPolling();
    super.dispose();
  }
}
