import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/support_service.dart';

/// Support tickets against the real API. Categories match the server
/// exactly (RIDE_ISSUE, PAYMENT, SAFETY, ACCOUNT, OTHER) — anything
/// else is rejected server-side, so the dropdown only offers these.
class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key});
  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  static const _categories = [
    'RIDE_ISSUE',
    'PAYMENT',
    'SAFETY',
    'ACCOUNT',
    'OTHER',
  ];

  List<dynamic> _tickets = [];
  String? _error;
  String? _message;
  bool _loading = true;
  String _category = 'RIDE_ISSUE';
  final _subject = TextEditingController();
  final _messageText = TextEditingController();
  final _rideId = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _subject.dispose();
    _messageText.dispose();
    _rideId.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final tickets = await context.read<SupportService>().listMyTickets();
      if (!mounted) return;
      setState(() {
        _tickets = tickets;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _create() async {
    if (_subject.text.trim().isEmpty || _messageText.text.trim().isEmpty) {
      setState(() => _message = 'Subject and message are required.');
      return;
    }
    try {
      await context.read<SupportService>().createTicket(
            category: _category,
            subject: _subject.text.trim(),
            message: _messageText.text.trim(),
            rideId: _rideId.text.trim().isEmpty ? null : _rideId.text.trim(),
          );
      if (!mounted) return;
      setState(() => _message = 'Ticket created — support will reply here.');
      _subject.clear();
      _messageText.clear();
      _rideId.clear();
      await _load();
    } catch (e) {
      if (!mounted) return;
      setState(() => _message = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Support')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('New ticket',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _category,
              decoration: const InputDecoration(labelText: 'Category'),
              items: _categories
                  .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                  .toList(),
              onChanged: (value) {
                if (value != null) setState(() => _category = value);
              },
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _subject,
              decoration: const InputDecoration(labelText: 'Subject'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _messageText,
              decoration: const InputDecoration(labelText: 'Message'),
              maxLines: 4,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _rideId,
              decoration: const InputDecoration(
                  labelText: 'Ride ID (optional)'),
            ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _create,
              child: const Text('Create ticket'),
            ),
            if (_message != null) ...[
              const SizedBox(height: 8),
              Text(_message!),
            ],
            const SizedBox(height: 24),
            const Text('My tickets',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_error != null)
              Text(_error!, style: const TextStyle(color: Colors.red))
            else if (_tickets.isEmpty)
              const Text('No tickets yet.',
                  style: TextStyle(color: Colors.grey))
            else
              for (final ticket in _tickets)
                ListTile(
                  title: Text(ticket['subject'] as String? ?? 'Ticket'),
                  subtitle: Text(
                      '${ticket['category'] ?? ''} · ${ticket['status'] ?? ''}'),
                ),
          ],
        ),
      ),
    );
  }
}
