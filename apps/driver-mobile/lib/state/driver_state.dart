import 'package:flutter/foundation.dart';
import '../services/driver_service.dart';

/// Driver onboarding state. canAcceptRides comes from the server
/// (APPROVED + active approved vehicle) — never from a local flag.
class DriverState extends ChangeNotifier {
  final DriverService service;
  DriverState(this.service);

  Map<String, dynamic>? status;
  List<dynamic> incoming = [];
  bool busy = false;
  bool online = false;
  String? error;

  String get kycStatus {
    final profile = status?['profile'] as Map<String, dynamic>?;
    return (profile?['kycStatus'] as String?) ?? 'UNKNOWN';
  }

  bool get canAcceptRides => (status?['canAcceptRides'] as bool?) ?? false;

  Future<void> refresh() async {
    try {
      status = await service.getStatus();
      try {
        incoming = await service.incomingRequests();
      } catch (_) {
        incoming = [];
      }
      error = null;
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  Future<void> register({String? emergencyContactName, String? emergencyContactPhone, String? bankAccount}) async {
    busy = true;
    notifyListeners();
    try {
      await service.register(
        emergencyContactName: emergencyContactName,
        emergencyContactPhone: emergencyContactPhone,
        bankAccount: bankAccount,
      );
      await refresh();
    } catch (e) {
      error = e.toString();
      rethrow;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> submit() async {
    await service.submit();
    await refresh();
  }

  /// Toggles the real server online state. The server enforces the
  /// canAcceptRides gate, so a local switch can never override it;
  /// a failure (e.g. no location yet) surfaces as an error, not a
  /// silently flipped switch.
  Future<void> toggleOnline() async {
    busy = true;
    notifyListeners();
    try {
      final result = online ? await service.goOffline() : await service.goOnline();
      online = (result['online'] as bool?) ?? false;
      if (online) incoming = await service.incomingRequests();
      error = null;
    } catch (e) {
      error = e.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }
}
