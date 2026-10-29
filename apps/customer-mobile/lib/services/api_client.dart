import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Typed HTTP client for the Rahi API. Tokens live in secure storage,
/// never in plain files or logs. The client never calculates fares —
/// it only sends coordinates/service and displays server values.
class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);
  @override
  String toString() => 'ApiException($status): $message';
}

class ApiClient {
  // Android emulator reaches the host at 10.0.2.2. Override with
  // --dart-define=API_BASE_URL=https://api.example.com/api/v1 for real builds.
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3001/api/v1',
  );

  final _storage = const FlutterSecureStorage();
  static const _accessKey = 'rahi_access_token';
  static const _refreshKey = 'rahi_refresh_token';

  Future<String?> get accessToken => _storage.read(key: _accessKey);
  Future<String?> get refreshToken => _storage.read(key: _refreshKey);

  Future<void> saveTokens(String access, String refresh) async {
    await _storage.write(key: _accessKey, value: access);
    await _storage.write(key: _refreshKey, value: refresh);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
  }) async {
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (authenticated) {
      final token = await accessToken;
      if (token != null) headers['Authorization'] = 'Bearer $token';
    }
    final uri = Uri.parse('$baseUrl$path');
    final response = method == 'GET'
        ? await http.get(uri, headers: headers)
        : method == 'PATCH'
            ? await http.patch(uri, headers: headers, body: jsonEncode(body ?? {}))
            : await http.post(uri, headers: headers, body: jsonEncode(body ?? {}));
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      return (decoded['data'] as Map<String, dynamic>?) ?? decoded;
    }
    String message = 'Request failed (${response.statusCode})';
    try {
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      message = (decoded['message'] as String?) ?? message;
    } catch (_) {}
    throw ApiException(response.statusCode, message);
  }

  Future<Map<String, dynamic>> get(String path) => _request('GET', path);

  /// Phase 12: list endpoints return a JSON array under 'data', which
  /// _request cannot unwrap into a Map — this method returns the array.
  Future<List<dynamic>> getList(String path) async {
    final headers = <String, String>{'Content-Type': 'application/json'};
    final token = await accessToken;
    if (token != null) headers['Authorization'] = 'Bearer $token';
    final response = await http.get(Uri.parse('$baseUrl$path'), headers: headers);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      return decoded['data'] as List<dynamic>;
    }
    throw ApiException(response.statusCode, 'Request failed (${response.statusCode})');
  }
  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body, {bool authenticated = true}) =>
      _request('POST', path, body: body, authenticated: authenticated);
  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) =>
      _request('PATCH', path, body: body);
}
