import 'api_client.dart';

/// Phase 14 support + safety client. Ratings, tickets, SOS and
/// share-trip links — all server-enforced, the app only carries
/// the user's own words and taps.
class SupportService {
  final ApiClient api;
  SupportService(this.api);

  Future<Map<String, dynamic>> rateRide(
    String rideId, {
    required int stars,
    String? comment,
    String? reportReason,
  }) =>
      api.post('/trips/$rideId/ratings', {
        'stars': stars,
        if (comment != null) 'comment': comment,
        if (reportReason != null) 'reportReason': reportReason,
      });

  Future<Map<String, dynamic>> createTicket({
    String? rideId,
    required String category,
    required String subject,
    required String message,
  }) =>
      api.post('/support/tickets', {
        if (rideId != null) 'rideId': rideId,
        'category': category,
        'subject': subject,
        'message': message,
      });

  Future<List<dynamic>> listMyTickets() => api.getList('/support/tickets');

  Future<Map<String, dynamic>> sos(String rideId, {String? note}) =>
      api.post('/trips/$rideId/sos', {if (note != null) 'note': note});

  Future<Map<String, dynamic>> createShareLink(String rideId, {int ttlMinutes = 60}) =>
      api.post('/trips/$rideId/share', {'ttlMinutes': ttlMinutes});
}
