import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/auth_state.dart';

/// Phone OTP login against the Phase 3 API. No code is ever shown in
/// the UI beyond what the user types, and no account is created locally.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _phone = TextEditingController(text: '+92');
  final _code = TextEditingController();
  bool _otpSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _requestOtp() async {
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<AuthState>().requestOtp(_phone.text.trim());
      setState(() => _otpSent = true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() { _busy = true; _error = null; });
    try {
      await context.read<AuthState>().verifyOtp(_phone.text.trim(), _code.text.trim());
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rahi — Sign in')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Enter your phone number to continue.', style: TextStyle(fontSize: 17)),
            const SizedBox(height: 24),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone (E.164, e.g. +923001234567)'),
            ),
            const SizedBox(height: 16),
            if (_otpSent) ...[
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(labelText: '6-digit code'),
              ),
              const SizedBox(height: 16),
            ],
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 16),
            ],
            ElevatedButton(
              onPressed: _busy ? null : (_otpSent ? _verify : _requestOtp),
              child: _busy
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(_otpSent ? 'Verify code' : 'Send code'),
            ),
            if (_otpSent)
              TextButton(onPressed: _busy ? null : _requestOtp, child: const Text('Resend code')),
          ],
        ),
      ),
    );
  }
}
