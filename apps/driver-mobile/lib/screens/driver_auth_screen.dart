import 'package:flutter/material.dart';
import '../services/driver_service.dart';

/// Shared phone-OTP login (same account, multiple roles). On success the
/// caller refreshes driver status; this screen holds no tokens itself.
class DriverAuthScreen extends StatefulWidget {
  final VoidCallback onVerified;
  const DriverAuthScreen({super.key, required this.onVerified});
  @override
  State<DriverAuthScreen> createState() => _DriverAuthScreenState();
}

class _DriverAuthScreenState extends State<DriverAuthScreen> {
  final _phone = TextEditingController(text: '+92');
  final _code = TextEditingController();
  final _service = DriverService();
  bool _otpSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rahi Driver — Sign in')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone (E.164)')),
            const SizedBox(height: 16),
            if (_otpSent)
              TextField(controller: _code, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: '6-digit code')),
            if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: const TextStyle(color: Colors.red))],
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() { _busy = true; _error = null; });
                      try {
                        if (!_otpSent) {
                          await _service.requestOtp(_phone.text.trim());
                          setState(() => _otpSent = true);
                        } else {
                          await _service.verifyOtp(_phone.text.trim(), _code.text.trim());
                          widget.onVerified();
                        }
                      } catch (e) {
                        setState(() => _error = e.toString());
                      } finally {
                        setState(() => _busy = false);
                      }
                    },
              child: Text(_otpSent ? 'Verify code' : 'Send code'),
            ),
          ],
        ),
      ),
    );
  }
}
