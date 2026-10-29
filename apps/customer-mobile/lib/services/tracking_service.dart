import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Phase 9 live-tracking client for the customer app. Joins the ride's
/// Socket.IO room and streams locationUpdate events to a callback.
/// UI wiring (map marker + ETA card) lands with the live-trip screens
/// in Phase 10; this client is the transport, not a fake trip.
class TrackingService {
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3001',
  );
  final _storage = const FlutterSecureStorage();
  io.Socket? _socket;

  Future<void> connect(String rideId, void Function(Map<String, dynamic> update) onLocation) async {
    final token = await _storage.read(key: 'rahi_access_token');
    // Socket.IO lives at the API root, not under /api/v1.
    final socketUrl = baseUrl.replaceAll('/api/v1', '');
    _socket = io.io(socketUrl, <String, dynamic>{
      'transports': ['websocket'],
      'auth': {'token': token},
    });
    _socket!.onConnect((_) {
      _socket!.emitWithAck('joinRide', {'rideId': rideId}, ack: (_) {});
    });
    _socket!.on('locationUpdate', (data) {
      if (data is Map<String, dynamic>) onLocation(data);
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }
}
