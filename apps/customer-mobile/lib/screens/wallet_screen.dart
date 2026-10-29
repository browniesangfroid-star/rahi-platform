import 'package:flutter/material.dart';

/// Wallet arrives with the ledger in Phase 12. Showing a zero balance
/// now would be misleading, so this screen states the status plainly.
class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.account_balance_wallet, size: 48, color: Colors.grey),
            SizedBox(height: 16),
            Text('Wallet — coming in Phase 12', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            SizedBox(height: 8),
            Text(
              'Cash is the payment method for the pilot. Wallet top-up, ledger history and payouts arrive with Phase 12.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
