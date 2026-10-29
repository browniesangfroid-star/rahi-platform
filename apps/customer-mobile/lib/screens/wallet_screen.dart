import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/wallet_service.dart';
import '../utils/fare.dart';

/// Real wallet, read from the server ledger — the app never computes
/// a balance locally, so it can never disagree with the server.
/// Cash stays the pilot payment method; top-ups here are requests
/// an admin approves, not instant money.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});
  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Map<String, dynamic>? _wallet;
  List<dynamic> _topups = [];
  String? _error;
  String? _message;
  bool _loading = true;
  final _amount = TextEditingController();
  final _reference = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final wallet = context.read<WalletService>();
      final data = await wallet.getWallet();
      final topups = await wallet.listTopups();
      if (!mounted) return;
      setState(() {
        _wallet = data;
        _topups = topups;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  int _balanceMinor() {
    final direct = (_wallet?['balanceMinor'] as num?)?.toInt();
    if (direct != null) return direct;
    final balance = _wallet?['balance'] as Map<String, dynamic>?;
    return (balance?['availableMinor'] as num?)?.toInt() ?? 0;
  }

  Future<void> _requestTopup() async {
    final pkr = int.tryParse(_amount.text.trim());
    if (pkr == null || pkr <= 0) {
      setState(() => _message = 'Enter a valid amount in PKR.');
      return;
    }
    try {
      await context.read<WalletService>().requestTopup(
            amountMinor: pkr * 100,
            reference: _reference.text.trim().isEmpty
                ? null
                : _reference.text.trim(),
          );
      if (!mounted) return;
      setState(() => _message = 'Top-up requested — an admin approves it.');
      _amount.clear();
      _reference.clear();
      await _load();
    } catch (e) {
      if (!mounted) return;
      setState(() => _message = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Wallet balance',
                      style: TextStyle(color: Colors.grey)),
                  const SizedBox(height: 4),
                  Text(formatMinor(_balanceMinor(), 'PKR'),
                      style: const TextStyle(
                          fontSize: 30, fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 20),
          const Text('Request top-up',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          TextField(
            controller: _amount,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Amount (PKR)'),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _reference,
            decoration: const InputDecoration(
                labelText: 'Reference (optional, e.g. JazzCash TrxID)'),
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: _requestTopup,
            child: const Text('Request top-up'),
          ),
          if (_message != null) ...[
            const SizedBox(height: 8),
            Text(_message!),
          ],
          const SizedBox(height: 24),
          const Text('Top-up history',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          if (_topups.isEmpty)
            const Text('No top-ups yet.',
                style: TextStyle(color: Colors.grey))
          else
            for (final item in _topups)
              ListTile(
                title: Text(formatMinor(
                    (item['amountMinor'] as num?)?.toInt() ?? 0, 'PKR')),
                subtitle: Text(
                    '${item['status'] ?? ''}${item['createdAt'] != null ? ' · ${item['createdAt']}' : ''}'),
              ),
          const SizedBox(height: 12),
          TextButton(onPressed: _load, child: const Text('Refresh')),
        ],
      ),
    );
  }
}
