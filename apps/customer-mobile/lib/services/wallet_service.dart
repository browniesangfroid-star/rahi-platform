import 'api_client.dart';

/// Phase 12 wallet client. Balances are always read from the server —
/// the app never computes a balance locally, so it can never disagree
/// with the ledger.
class WalletService {
  final ApiClient api;
  WalletService(this.api);

  Future<Map<String, dynamic>> getWallet() => api.get('/wallet/me');

  Future<Map<String, dynamic>> requestTopup({
    required int amountMinor,
    String? reference,
  }) =>
      api.post('/wallet/topups', {
        'ownerType': 'CUSTOMER',
        'amountMinor': amountMinor,
        if (reference != null) 'reference': reference,
      });

  Future<List<dynamic>> listTopups() => api.getList('/wallet/topups');

  Future<Map<String, dynamic>> getSettlement(String rideId) =>
      api.get('/payments/rides/$rideId');

  Future<Map<String, dynamic>> settleRide(String rideId) =>
      api.post('/payments/rides/$rideId/settle', {});
}
