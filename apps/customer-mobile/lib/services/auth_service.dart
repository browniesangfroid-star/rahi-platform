import 'api_client.dart';
import '../models/models.dart';

/// Auth against the Phase 3 API. No local password/OTP storage, no
/// client-side token generation — tokens come only from the server.
class AuthService {
  final ApiClient api;
  AuthService(this.api);

  Future<void> requestOtp(String phone) async {
    await api.post('/auth/request-otp', {'phone': phone}, authenticated: false);
  }

  Future<UserProfile> verifyOtp(String phone, String code) async {
    final data = await api.post('/auth/verify-otp', {'phone': phone, 'code': code}, authenticated: false);
    await api.saveTokens(data['accessToken'] as String, data['refreshToken'] as String);
    return UserProfile.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<UserProfile> getMe() async {
    final data = await api.get('/users/me');
    return UserProfile.fromJson(data);
  }

  Future<UserProfile> updateProfile(String firstName, String lastName) async {
    final data = await api.patch('/users/me', {'firstName': firstName, 'lastName': lastName});
    return UserProfile.fromJson(data);
  }

  Future<void> logout() async {
    final refresh = await api.refreshToken;
    if (refresh != null) {
      try {
        await api.post('/auth/logout', {'refreshToken': refresh});
      } catch (_) {
        // Logout is best-effort on the server side; local tokens are cleared anyway.
      }
    }
    await api.clearTokens();
  }
}
