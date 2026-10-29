import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import '../state/trip_state.dart';
import '../utils/fare.dart';

/// Live trip screen: status, map with the driver's live position,
/// pickup PIN, delivery OTP (delivery trips only), cancel, SOS,
/// share-trip and the post-trip rating. Every value comes from the
/// server; the app never invents a status, a fare or a position.
///
/// The PIN is shown from the accept response (plaintext exactly once).
/// If it was lost, "Regenerate PIN" asks the server for a new one.
class TripScreen extends StatefulWidget {
  const TripScreen({super.key});
  @override
  State<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends State<TripScreen> {
  final _reason = TextEditingController();
  final _sosNote = TextEditingController();
  final _ratingComment = TextEditingController();
  final _reportReason = TextEditingController();
  int _stars = 5;

  @override
  void dispose() {
    _reason.dispose();
    _sosNote.dispose();
    _ratingComment.dispose();
    _reportReason.dispose();
    super.dispose();
  }

  static double? _num(dynamic value) => (value as num?)?.toDouble();

  /// Pickup/destination coordinates, from the embedded request first,
  /// then from flat fields on the ride itself.
  LatLng? _point(Map<String, dynamic>? trip, String key) {
    final request = trip?['request'] as Map<String, dynamic>?;
    final nested = request?[key] as Map<String, dynamic>? ??
        trip?[key] as Map<String, dynamic>?;
    if (nested != null) {
      final lat = _num(nested['lat']);
      final lng = _num(nested['lng']);
      if (lat != null && lng != null) return LatLng(lat, lng);
    }
    final flatLat = _num(trip?['${key}Lat']);
    final flatLng = _num(trip?['${key}Lng']);
    if (flatLat != null && flatLng != null) return LatLng(flatLat, flatLng);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final tripState = context.watch<TripState>();
    final trip = tripState.trip;
    final request = trip?['request'] as Map<String, dynamic>?;
    final service = (request?['serviceCode'] as String?) ??
        (trip?['serviceCode'] as String?) ??
        '';
    final isDelivery = service == 'DELIVERY';
    final fare = (trip?['finalFareMinor'] as num?)?.toInt() ??
        (request?['suggestedFareMinor'] as num?)?.toInt();
    final pickup = _point(trip, 'pickup');
    final destination = _point(trip, 'destination');
    final driverPos = tripState.driverLocation;
    final markers = <Marker>[];
    if (pickup != null) {
      markers.add(Marker(
        point: pickup,
        child: const Icon(Icons.location_pin, color: Colors.teal, size: 40),
      ));
    }
    if (destination != null) {
      markers.add(Marker(
        point: destination,
        child: const Icon(Icons.flag, color: Colors.amber, size: 40),
      ));
    }
    if (driverPos != null) {
      markers.add(Marker(
        point: LatLng(driverPos.lat, driverPos.lng),
        child: const Icon(Icons.local_taxi, color: Colors.teal, size: 36),
      ));
    }
    final center = driverPos != null
        ? LatLng(driverPos.lat, driverPos.lng)
        : pickup ?? const LatLng(33.6844, 73.0479); // Islamabad pilot centre.

    return Scaffold(
      appBar: AppBar(title: const Text('Your trip')),
      body: Column(
        children: [
          Expanded(
            child: FlutterMap(
              options: MapOptions(initialCenter: center, initialZoom: 14),
              children: [
                TileLayer(
                  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                  userAgentPackageName: 'com.rahi.customer',
                ),
                if (markers.isNotEmpty) MarkerLayer(markers: markers),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Status: ${tripState.statusLabel}',
                      style: const TextStyle(
                          fontSize: 19, fontWeight: FontWeight.bold)),
                  if (fare != null) ...[
                    const SizedBox(height: 4),
                    Text('Fare: ${formatMinor(fare, 'PKR')}',
                        style: const TextStyle(fontSize: 17)),
                  ],
                  if (tripState.error != null) ...[
                    const SizedBox(height: 8),
                    Text(tripState.error!,
                        style: const TextStyle(color: Colors.red)),
                  ],
                  if (tripState.pickupPin != null && !tripState.isTerminal) ...[
                    const SizedBox(height: 16),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Pickup PIN — show this to your driver',
                                style: TextStyle(fontWeight: FontWeight.w600)),
                            const SizedBox(height: 8),
                            Text(tripState.pickupPin!,
                                style: const TextStyle(
                                    fontSize: 32,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 8)),
                            const SizedBox(height: 8),
                            TextButton(
                              onPressed: tripState.regeneratePin,
                              child: const Text('Regenerate PIN'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  if (isDelivery && tripState.deliveryOtp != null &&
                      !tripState.isTerminal) ...[
                    const SizedBox(height: 12),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                                'Recipient OTP — the recipient gives this to the driver',
                                style: TextStyle(fontWeight: FontWeight.w600)),
                            const SizedBox(height: 8),
                            Text(tripState.deliveryOtp!,
                                style: const TextStyle(
                                    fontSize: 32,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 8)),
                            const SizedBox(height: 8),
                            TextButton(
                              onPressed: tripState.regenerateDeliveryOtp,
                              child: const Text('Regenerate recipient OTP'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  if (!tripState.isTerminal) ...[
                    const SizedBox(height: 16),
                    TextField(
                      controller: _reason,
                      decoration: const InputDecoration(
                          labelText: 'Cancel reason (optional)'),
                    ),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      onPressed: tripState.busy
                          ? null
                          : () => tripState.cancelTrip(
                              reason: _reason.text.trim().isEmpty
                                  ? null
                                  : _reason.text.trim()),
                      child: const Text('Cancel trip'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _sosNote,
                      decoration: const InputDecoration(
                          labelText: 'SOS note (optional)'),
                    ),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.red),
                      onPressed: () => tripState.sos(
                          note: _sosNote.text.trim().isEmpty
                              ? null
                              : _sosNote.text.trim()),
                      child: const Text('SOS — alert support'),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: tripState.createShareLink,
                      child: const Text('Share trip link (60 min)'),
                    ),
                    if (tripState.lastShareLink != null) ...[
                      const SizedBox(height: 8),
                      SelectableText(tripState.lastShareLink!),
                    ],
                  ],
                  if (tripState.status == 'COMPLETED') ...[
                    const SizedBox(height: 20),
                    const Text('Rate your trip',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(5, (i) {
                        final star = i + 1;
                        return IconButton(
                          icon: Icon(
                            Icons.star,
                            color: star <= _stars
                                ? Colors.amber
                                : Colors.grey,
                          ),
                          onPressed: () => setState(() => _stars = star),
                        );
                      }),
                    ),
                    TextField(
                      controller: _ratingComment,
                      decoration: const InputDecoration(
                          labelText: 'Comment (optional)'),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _reportReason,
                      decoration: const InputDecoration(
                          labelText: 'Report reason (optional)'),
                    ),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: tripState.busy
                          ? null
                          : () => tripState.rate(
                                _stars,
                                comment: _ratingComment.text.trim().isEmpty
                                    ? null
                                    : _ratingComment.text.trim(),
                                reportReason:
                                    _reportReason.text.trim().isEmpty
                                        ? null
                                        : _reportReason.text.trim(),
                              ),
                      child: const Text('Submit rating'),
                    ),
                  ],
                  if (tripState.isTerminal) ...[
                    const SizedBox(height: 20),
                    OutlinedButton(
                      onPressed: () async {
                        await tripState.clearTrip();
                        if (context.mounted) Navigator.of(context).pop();
                      },
                      child: const Text('Close trip'),
                    ),
                  ],
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: tripState.refresh,
                    child: const Text('Refresh status'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
