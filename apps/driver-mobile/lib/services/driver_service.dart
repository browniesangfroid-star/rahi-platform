import 'dart:convert';
import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Driver API client. Document uploads use multipart POST to the Phase 5
/// endpoint; files are stored privately server-side, never as public URLs.
class DriverApiException implements Exception {
  final int status;
  final String message;
  DriverApiException(this.status, this.message);
  @override
  String toString() => 'DriverApiException($status): $message';
}

class DriverService {
  // Live Rahi API on Render. Override with
  // --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1 for a local
  // emulator build against a dev server.
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://rahi-platform.onrender.com/api/v1',
  );
  final _storage = const FlutterSecureStorage();

  Future<Map<String, String>> _headers() async {
    final token = await _storage.read(key: 'rahi_access_token');
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> _postJson(String path, Map<String, dynamic> body) async {
    final response = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(),
      body: jsonEncode(body),
    );
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return (jsonDecode(response.body) as Map<String, dynamic>)['data'] as Map<String, dynamic>;
    }
    throw DriverApiException(response.statusCode, response.body);
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final response = await http.get(Uri.parse('$baseUrl$path'), headers: await _headers());
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return (jsonDecode(response.body) as Map<String, dynamic>)['data'] as Map<String, dynamic>;
    }
    throw DriverApiException(response.statusCode, response.body);
  }

  // Phone OTP auth is shared with the customer app: one account,
  // multiple roles. Tokens are stored under the same secure keys.
  Future<void> requestOtp(String phone) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/request-otp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'phone': phone}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw DriverApiException(response.statusCode, response.body);
    }
  }

  Future<void> verifyOtp(String phone, String code) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/verify-otp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'phone': phone, 'code': code}),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw DriverApiException(response.statusCode, response.body);
    }
    final data = (jsonDecode(response.body) as Map<String, dynamic>)['data'] as Map<String, dynamic>;
    await _storage.write(key: 'rahi_access_token', value: data['accessToken'] as String);
    await _storage.write(key: 'rahi_refresh_token', value: data['refreshToken'] as String);
  }

  Future<Map<String, dynamic>> register({String? emergencyContactName, String? emergencyContactPhone, String? bankAccount}) {
    return _postJson('/drivers/register', {
      if (emergencyContactName != null) 'emergencyContactName': emergencyContactName,
      if (emergencyContactPhone != null) 'emergencyContactPhone': emergencyContactPhone,
      if (bankAccount != null) 'bankAccount': bankAccount,
    });
  }

  Future<Map<String, dynamic>> getStatus() => _get('/drivers/status');

  /// The driver's current non-terminal ride, or null. Acceptance
  /// happens customer-side and there is no push channel, so the app
  /// polls this to learn that an offer was accepted.
  Future<Map<String, dynamic>?> getActiveTrip() async {
    final token = await _storage.read(key: 'rahi_access_token');
    final response = await http.get(
      Uri.parse('$baseUrl/drivers/active-trip'),
      headers: {if (token != null) 'Authorization': 'Bearer $token'},
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw DriverApiException(response.statusCode, response.body);
    }
    final data = (jsonDecode(response.body) as Map<String, dynamic>)['data'];
    return data as Map<String, dynamic>?;
  }

  /// Offer actions on the driver's own offer. The customer accepts;
  /// the driver creates, re-prices (counter) or declines their offer.
  /// A fare is required for NEGOTIATION/HYBRID and ignored for
  /// FIXED/DYNAMIC — the server enforces both, never the app.
  Future<Map<String, dynamic>> createOffer(String requestId, {int? fareMinor}) =>
      _postJson('/rides/$requestId/offers', {
        if (fareMinor != null) 'fareMinor': fareMinor,
      });

  Future<Map<String, dynamic>> counterOffer(
          String requestId, String offerId, int fareMinor) =>
      _postJson('/rides/$requestId/offers/$offerId/counter', {'fareMinor': fareMinor});

  Future<Map<String, dynamic>> declineOffer(String requestId, String offerId) =>
      _postJson('/rides/$requestId/offers/$offerId/decline', {});

  /// Ratings are symmetric: the driver rates the customer with the
  /// same endpoint the customer uses to rate the driver.
  Future<Map<String, dynamic>> rateRide(
    String rideId, {
    required int stars,
    String? comment,
    String? reportReason,
  }) =>
      _postJson('/trips/$rideId/ratings', {
        'stars': stars,
        if (comment != null) 'comment': comment,
        if (reportReason != null) 'reportReason': reportReason,
      });

  Future<void> logout() async {
    final refresh = await _storage.read(key: 'rahi_refresh_token');
    if (refresh != null) {
      try {
        await _postJson('/auth/logout', {'refreshToken': refresh});
      } catch (_) {
        // Best-effort; local tokens are cleared anyway.
      }
    }
    await _storage.delete(key: 'rahi_access_token');
    await _storage.delete(key: 'rahi_refresh_token');
  }

  /// Trip detail for the assigned driver (status, fare, request,
  /// timeline). The trip screen polls this while the trip is live.
  Future<Map<String, dynamic>> getTrip(String rideId) => _get('/trips/$rideId');

  /// Trip actions for the assigned driver, wired to the trip screen.
  Future<Map<String, dynamic>> tripEnRoute(String rideId) => _postJson('/trips/$rideId/en-route', {});
  Future<Map<String, dynamic>> tripArrived(String rideId) => _postJson('/trips/$rideId/arrived', {});
  Future<Map<String, dynamic>> tripBeginPin(String rideId) => _postJson('/trips/$rideId/begin-pin-verification', {});
  Future<Map<String, dynamic>> tripVerifyPin(String rideId, String pin) => _postJson('/trips/$rideId/verify-pin', {'pin': pin});
  Future<Map<String, dynamic>> tripComplete(String rideId) => _postJson('/trips/$rideId/complete', {});
  Future<Map<String, dynamic>> tripDriverCancel(String rideId, String reason) => _postJson('/trips/$rideId/driver-cancel', {'reason': reason});
  Future<Map<String, dynamic>> tripNoShow(String rideId) => _postJson('/trips/$rideId/no-show', {});

  /// Phase 12: driver wallet (earnings, commission debt, withdrawals).
  Future<Map<String, dynamic>> getWallet() async {
    final token = await _storage.read(key: 'rahi_access_token');
    final response = await http.get(
      Uri.parse('$baseUrl/wallet/me?role=DRIVER'),
      headers: {if (token != null) 'Authorization': 'Bearer $token'},
    );
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return (jsonDecode(response.body) as Map<String, dynamic>)['data'] as Map<String, dynamic>;
    }
    throw DriverApiException(response.statusCode, response.body);
  }

  Future<Map<String, dynamic>> requestWithdrawal(int amountMinor) =>
      _postJson('/wallet/withdrawals', {'ownerType': 'DRIVER', 'amountMinor': amountMinor});

  Future<List<dynamic>> listWithdrawals() async {
    final token = await _storage.read(key: 'rahi_access_token');
    final response = await http.get(
      Uri.parse('$baseUrl/wallet/withdrawals'),
      headers: {if (token != null) 'Authorization': 'Bearer $token'},
    );
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return (jsonDecode(response.body) as Map<String, dynamic>)['data'] as List<dynamic>;
    }
    throw DriverApiException(response.statusCode, response.body);
  }

  /// Phase 14: SOS during a live trip. Creates a HIGH-priority
  /// incident with a snapshot for ops — it does not contact police.
  Future<Map<String, dynamic>> sos(String rideId, {String? note}) =>
      _postJson('/trips/$rideId/sos', {if (note != null) 'note': note});

  /// Phase 11 delivery actions for the courier. Photo evidence is a
  /// private multipart upload, like KYC documents — never a public URL.
  Future<Map<String, dynamic>> deliveryArrivedAtRecipient(String rideId) =>
      _postJson('/trips/$rideId/delivery/arrived-at-recipient', {});
  Future<Map<String, dynamic>> deliveryVerifyOtp(String rideId, String otp) =>
      _postJson('/trips/$rideId/delivery/verify-otp', {'otp': otp});

  Future<Map<String, dynamic>> uploadDeliveryPhoto(String rideId, File file) async {
    final token = await _storage.read(key: 'rahi_access_token');
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/trips/$rideId/delivery/photo'));
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    request.files.add(await http.MultipartFile.fromPath('file', file.path));
    final streamed = await request.send();
    final body = await streamed.stream.bytesToString();
    if (streamed.statusCode >= 200 && streamed.statusCode < 300) {
      return (jsonDecode(body) as Map<String, dynamic>)['data'] as Map<String, dynamic>;
    }
    throw DriverApiException(streamed.statusCode, body);
  }

  /// Phase 8: dispatched OFFERING requests for this driver, each with
  /// the driver's own live offer (or null). Offer accept/counter UI
  /// lands with the live-trip screens in Phase 10.
  Future<List<dynamic>> incomingRequests() async {
    final response = await http.get(Uri.parse('$baseUrl/drivers/incoming-requests'), headers: await _headers());
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return (jsonDecode(response.body) as Map<String, dynamic>)['data'] as List<dynamic>;
    }
    throw DriverApiException(response.statusCode, response.body);
  }
  Future<Map<String, dynamic>> submit() => _postJson('/drivers/submit', {});

  /// Phase 7 online/offline. GPS pings (location) land in Phase 9;
  /// until then goOnline reuses the driver's last server-side location,
  /// and the server refuses to go online with no location at all.
  Future<Map<String, dynamic>> goOnline({double? lat, double? lng}) => _postJson('/drivers/online', {
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
      });
  Future<Map<String, dynamic>> goOffline() => _postJson('/drivers/offline', {});
  Future<Map<String, dynamic>> updateLocation(double lat, double lng) =>
      _postJson('/drivers/location', {'lat': lat, 'lng': lng});
  Future<Map<String, dynamic>> createVehicle(Map<String, dynamic> vehicle) => _postJson('/drivers/vehicles', vehicle);
  Future<Map<String, dynamic>> activateVehicle(String vehicleId) => _postJson('/drivers/vehicles/$vehicleId/activate', {});

  Future<Map<String, dynamic>> uploadDocument(String documentType, File file) async {
    final token = await _storage.read(key: 'rahi_access_token');
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/drivers/documents'));
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    request.fields['documentType'] = documentType;
    request.files.add(await http.MultipartFile.fromPath('file', file.path));
    final streamed = await request.send();
    final body = await streamed.stream.bytesToString();
    if (streamed.statusCode >= 200 && streamed.statusCode < 300) {
      return (jsonDecode(body) as Map<String, dynamic>)['data'] as Map<String, dynamic>;
    }
    throw DriverApiException(streamed.statusCode, body);
  }
}
