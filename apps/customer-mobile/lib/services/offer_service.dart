import 'api_client.dart';

/// Offer + request-list client for the customer app.
///
/// Server contract (offers live under /rides):
/// - The CUSTOMER lists offers and ACCEPTS one. Decline/counter are
///   driver actions on their own offer, so this client deliberately
///   exposes no customer decline/counter — the server forbids them
///   (403) and a button for them would be a dead end. A customer who
///   likes no offer cancels the whole request instead.
class OfferService {
  final ApiClient api;
  OfferService(this.api);

  Future<List<dynamic>> listOffers(String requestId) =>
      api.getList('/rides/$requestId/offers');

  /// Returns the accept payload: the ride plus the pickup PIN
  /// (plaintext exactly once) and, for delivery, the recipient OTP.
  Future<Map<String, dynamic>> acceptOffer(String requestId, String offerId) =>
      api.post('/rides/$requestId/offers/$offerId/accept', {});

  Future<List<dynamic>> listMyRequests() => api.getList('/rides');

  Future<Map<String, dynamic>> getRequest(String requestId) =>
      api.get('/rides/$requestId');

  Future<List<dynamic>> getTimeline(String requestId) =>
      api.getList('/rides/$requestId/timeline');

  Future<Map<String, dynamic>> cancelRequest(String requestId, {String? reason}) =>
      api.post('/rides/$requestId/cancel', {if (reason != null) 'reason': reason});
}
