import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/auth_state.dart';

/// Profile backed by the real Phase 3 /users/me endpoint. Name edits
/// call PATCH /users/me; nothing here is local-only.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _first = TextEditingController();
  final _last = TextEditingController();
  bool _loaded = false;
  String? _message;

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    final user = auth.user;
    if (user != null && !_loaded) {
      _first.text = user.firstName;
      _last.text = user.lastName;
      _loaded = true;
    }
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(user?.displayName ?? 'Profile', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(user?.phone ?? user?.email ?? ''),
          const SizedBox(height: 24),
          TextField(controller: _first, decoration: const InputDecoration(labelText: 'First name')),
          const SizedBox(height: 12),
          TextField(controller: _last, decoration: const InputDecoration(labelText: 'Last name')),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () async {
              try {
                await auth.updateProfile(_first.text.trim(), _last.text.trim());
                setState(() => _message = 'Saved.');
              } catch (e) {
                setState(() => _message = e.toString());
              }
            },
            child: const Text('Save profile'),
          ),
          if (_message != null) ...[const SizedBox(height: 12), Text(_message!)],
          const Spacer(),
          OutlinedButton(onPressed: auth.logout, child: const Text('Log out')),
        ],
      ),
    );
  }
}
