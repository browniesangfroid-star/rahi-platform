import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Phase 9 live-tracking client for the driver app. The driver joins
/// the ride room and sends positions; GPS acquisition (geolocator +
/// platform permissions) lands in Phase 10, so sendLocation takes
/// coordinates from its caller for now rather than inventing them.
class DriverTrackingService {
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3001/api/v1',
  );
  final _storage = const FlutterSecureStorage();
  io.Socket? _socket;

  Future<void> connect(String rideId) async {
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
  }

  void sendLocation(String rideId, double lat, double lng) {
    _socket?.emitWithAck('driverLocation', {'rideId': rideId, 'lat': lat, 'lng': lng}, ack: (_) {});
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }
}
