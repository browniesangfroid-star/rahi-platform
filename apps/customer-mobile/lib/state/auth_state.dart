import 'package:flutter/foundation.dart';
import '../models/models.dart';
import '../services/auth_service.dart';

enum AuthStatus { unknown, unauthenticated, authenticated }

/// Holds the signed-in user only. Tokens stay in secure storage via ApiClient.
class AuthState extends ChangeNotifier {
  final AuthService auth;
  AuthState(this.auth);

  AuthStatus status = AuthStatus.unknown;
  UserProfile? user;
  String? error;

  Future<void> restore() async {
    try {
      user = await auth.getMe();
      status = AuthStatus.authenticated;
    } catch (_) {
      status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  Future<void> requestOtp(String phone) async {
    error = null;
    notifyListeners();
    try {
      await auth.requestOtp(phone);
    } catch (e) {
      error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  Future<void> verifyOtp(String phone, String code) async {
    error = null;
    try {
      user = await auth.verifyOtp(phone, code);
      status = AuthStatus.authenticated;
    } catch (e) {
      error = e.toString();
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  Future<void> updateProfile(String firstName, String lastName) async {
    user = await auth.updateProfile(firstName, lastName);
    notifyListeners();
  }

  Future<void> logout() async {
    await auth.logout();
    user = null;
    status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}
