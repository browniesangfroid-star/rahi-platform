import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import '../services/driver_service.dart';
import '../services/tracking_service.dart';

/// Active-trip state for the driver app.
///
/// The driver learns about acceptance by polling GET
/// /drivers/active-trip (acceptance happens customer-side and there
/// is no push channel). Once a trip is live, GPS is sent to the
/// server every 15 seconds and into the ride's socket room, so the
/// customer sees the driver moving. Every transition is
/// server-enforced; this state only carries the driver's taps.
class DriverTripState extends ChangeNotifier {
  final DriverService service;
  final DriverTrackingService tracking;
  DriverTripState(this.service, this.tracking);

  static const _rideKey = 'rahi_driver_active_ride';
  final _storage = const FlutterSecureStorage();

  String? activeRideId;
  Map<String, dynamic>? trip;
  String? error;
  bool busy = false;
  Timer? _poll;
  Timer? _gps;

  String get status => (trip?['status'] as String?) ?? 'UNKNOWN';

  bool get isTerminal =>
      status == 'COMPLETED' ||
      status.startsWith('CANCELLED') ||
      status == 'NO_SHOW';

  String get statusLabel => status.replaceAll('_', ' ');

  bool get isDelivery {
    final request = trip?['request'] as Map<String, dynamic>?;
    final tripService = (request?['serviceCode'] as String?) ??
        (trip?['serviceCode'] as String?);
    return tripService == 'DELIVERY';
  }

  /// Restore a trip from storage, or discover one the customer just
  /// accepted while the app was closed.
  Future<void> restore() async {
    activeRideId = await _storage.read(key: _rideKey);
    if (activeRideId == null) {
      try {
        final active = await service.getActiveTrip();
        if (active != null) activeRideId = active['id'] as String?;
      } catch (_) {}
    }
    if (activeRideId != null) {
      await _storage.write(key: _rideKey, value: activeRideId!);
      await refresh();
      if (!isTerminal) {
        _startPolling();
        _startGpsLoop();
      }
    }
    notifyListeners();
  }

  /// Called when polling discovers a trip the customer just accepted.
  Future<void> checkForNewTrip() async {
    if (activeRideId != null) return;
    try {
      final active = await service.getActiveTrip();
      if (active != null) {
        activeRideId = active['id'] as String;
        await _storage.write(key: _rideKey, value: activeRideId!);
        await refresh();
        _startPolling();
        _startGpsLoop();
        notifyListeners();
      }
    } catch (_) {}
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => refresh());
  }

  void _startGpsLoop() {
    _gps?.cancel();
    // Join the ride's socket room so GPS ticks also stream to the
    // customer live; without this, sendLocation would be a no-op.
    if (activeRideId != null) {
      tracking.connect(activeRideId!);
    }
    _gps = Timer.periodic(const Duration(seconds: 15), (_) => _sendPosition());
    _sendPosition();
  }

  Future<void> _sendPosition() async {
    try {
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        await Geolocator.requestPermission();
      }
      final position = await Geolocator.getCurrentPosition();
      await service.updateLocation(position.latitude, position.longitude);
      if (activeRideId != null) {
        tracking.sendLocation(
            activeRideId!, position.latitude, position.longitude);
      }
    } catch (_) {
      // GPS failures never break the trip: the server keeps the last
      // known location, and the next tick retries.
    }
  }

  void _stopLoops() {
    _poll?.cancel();
    _poll = null;
    _gps?.cancel();
    _gps = null;
    tracking.disconnect();
  }

  Future<void> refresh() async {
    if (activeRideId == null) return;
    try {
      trip = await service.getTrip(activeRideId!);
      error = null;
      if (isTerminal) _stopLoops();
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  Future<void> connectSocket() async {
    if (activeRideId == null) return;
    await tracking.connect(activeRideId!);
  }

  Future<void> _act(Future<Map<String, dynamic>> Function() call) async {
    if (activeRideId == null) return;
    busy = true;
    notifyListeners();
    try {
      trip = await call();
      error = null;
      if (isTerminal) _stopLoops();
    } catch (e) {
      error = e.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> enRoute() => _act(() => service.tripEnRoute(activeRideId!));
  Future<void> arrived() => _act(() => service.tripArrived(activeRideId!));
  Future<void> beginPin() =>
      _act(() => service.tripBeginPin(activeRideId!));
  Future<void> verifyPin(String pin) =>
      _act(() => service.tripVerifyPin(activeRideId!, pin));
  Future<void> complete() => _act(() => service.tripComplete(activeRideId!));
  Future<void> driverCancel(String reason) =>
      _act(() => service.tripDriverCancel(activeRideId!, reason));
  Future<void> noShow() => _act(() => service.tripNoShow(activeRideId!));

  Future<void> deliveryArrived() =>
      _act(() => service.deliveryArrivedAtRecipient(activeRideId!));
  Future<void> deliveryVerifyOtp(String otp) =>
      _act(() => service.deliveryVerifyOtp(activeRideId!, otp));

  Future<void> deliveryPhoto(File file) async {
    if (activeRideId == null) return;
    busy = true;
    notifyListeners();
    try {
      await service.uploadDeliveryPhoto(activeRideId!, file);
      error = null;
      await refresh();
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
      await service.sos(activeRideId!, note: note);
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
      await service.rateRide(activeRideId!,
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

  /// Clears the trip only after it ended — the driver explicitly
  /// closes it from the trip screen.
  Future<void> clearTrip() async {
    _stopLoops();
    activeRideId = null;
    trip = null;
    await _storage.delete(key: _rideKey);
    notifyListeners();
  }

  @override
  void dispose() {
    _stopLoops();
    super.dispose();
  }
}
