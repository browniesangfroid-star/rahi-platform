import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/driver_service.dart';
import '../utils/fare.dart';

/// Driver wallet: earnings balance, commission position and
/// withdrawals, all read from the server ledger. Cash trips push the
/// driver into commission debt (negative balance); card/wallet trips
/// pay it down. Withdrawal requests go to an admin for approval.
class DriverWalletScreen extends StatefulWidget {
  const DriverWalletScreen({super.key});
  @override
  State<DriverWalletScreen> createState() => _DriverWalletScreenState();
}

class _DriverWalletScreenState extends State<DriverWalletScreen> {
  Map<String, dynamic>? _wallet;
  List<dynamic> _withdrawals = [];
  String? _error;
  String? _message;
  bool _loading = true;
  final _amount = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final service = context.read<DriverService>();
      final wallet = await service.getWallet();
      final withdrawals = await service.listWithdrawals();
      if (!mounted) return;
      setState(() {
        _wallet = wallet;
        _withdrawals = withdrawals;
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

  Future<void> _requestWithdrawal() async {
    final pkr = int.tryParse(_amount.text.trim());
    if (pkr == null || pkr <= 0) {
      setState(() => _message = 'Enter a valid amount in PKR.');
      return;
    }
    try {
      await context
          .read<DriverService>()
          .requestWithdrawal(pkr * 100);
      if (!mounted) return;
      setState(
          () => _message = 'Withdrawal requested — an admin approves it.');
      _amount.clear();
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
                  const Text('Earnings balance',
                      style: TextStyle(color: Colors.grey)),
                  const SizedBox(height: 4),
                  Text(formatMinor(_balanceMinor(), 'PKR'),
                      style: const TextStyle(
                          fontSize: 30, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text(
                    'Negative means commission owed to Rahi from cash trips.',
                    style: TextStyle(color: Colors.grey),
                  ),
                ],
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 20),
          const Text('Request withdrawal',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          TextField(
            controller: _amount,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Amount (PKR)'),
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: _requestWithdrawal,
            child: const Text('Request withdrawal'),
          ),
          if (_message != null) ...[
            const SizedBox(height: 8),
            Text(_message!),
          ],
          const SizedBox(height: 24),
          const Text('Withdrawal history',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          if (_withdrawals.isEmpty)
            const Text('No withdrawals yet.',
                style: TextStyle(color: Colors.grey))
          else
            for (final item in _withdrawals)
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
