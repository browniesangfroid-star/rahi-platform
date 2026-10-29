import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../state/booking_state.dart';
import '../state/trip_state.dart';
import '../utils/fare.dart';
import 'offers_screen.dart';
import 'trip_screen.dart';

/// Booking funnel: map → service → pickup → destination → estimate →
/// offer → request → offers → trip. Map taps set pickup then
/// destination; the map opens on the Islamabad pilot centre.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _mapController = MapController();
  final _pickupLabel = TextEditingController();
  final _destinationLabel = TextEditingController();
  final _offer = TextEditingController();
  final _senderName = TextEditingController();
  final _senderPhone = TextEditingController();
  final _recipientName = TextEditingController();
  final _recipientPhone = TextEditingController();
  final _packageCategory = TextEditingController();
  String _paymentMethod = 'CASH';
  static const _islamabad = LatLng(33.6844, 73.0479);

  @override
  void dispose() {
    _mapController.dispose();
    _pickupLabel.dispose();
    _destinationLabel.dispose();
    _offer.dispose();
    _senderName.dispose();
    _senderPhone.dispose();
    _recipientName.dispose();
    _recipientPhone.dispose();
    _packageCategory.dispose();
    super.dispose();
  }

  bool get _deliveryValid =>
      _senderName.text.trim().isNotEmpty &&
      _senderPhone.text.trim().isNotEmpty &&
      _recipientName.text.trim().isNotEmpty &&
      _recipientPhone.text.trim().isNotEmpty &&
      _packageCategory.text.trim().isNotEmpty;

  void _onMapTap(TapPosition _, LatLng point) {
    final booking = context.read<BookingState>();
    final place = Place('Picked on map', GeoPoint(point.latitude, point.longitude));
    if (booking.pickup == null) {
      booking.setPickup(place);
      _pickupLabel.text = place.label;
    } else {
      booking.setDestination(place);
      _destinationLabel.text = place.label;
    }
  }

  Future<void> _useMyLocation() async {
    try {
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        await Geolocator.requestPermission();
      }
      final position = await Geolocator.getCurrentPosition();
      final place = Place('My location', GeoPoint(position.latitude, position.longitude));
      if (!mounted) return;
      context.read<BookingState>().setPickup(place);
      _pickupLabel.text = place.label;
      _mapController.move(LatLng(position.latitude, position.longitude), 15);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Location unavailable — tap the map to set pickup instead.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final booking = context.watch<BookingState>();
    final tripState = context.watch<TripState>();
    final markers = <Marker>[];
    if (booking.pickup != null) {
      markers.add(Marker(
        point: LatLng(booking.pickup!.point.lat, booking.pickup!.point.lng),
        child: const Icon(Icons.location_pin, color: Colors.teal, size: 40),
      ));
    }
    if (booking.destination != null) {
      markers.add(Marker(
        point: LatLng(booking.destination!.point.lat, booking.destination!.point.lng),
        child: const Icon(Icons.flag, color: Colors.amber, size: 40),
      ));
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Rahi'), actions: [
        IconButton(icon: const Icon(Icons.my_location), onPressed: _useMyLocation, tooltip: 'Current location'),
        IconButton(icon: const Icon(Icons.refresh), onPressed: booking.reset, tooltip: 'Clear booking'),
      ]),
      body: Column(
        children: [
          if (tripState.activeRideId != null)
            Card(
              margin: const EdgeInsets.all(8),
              child: ListTile(
                leading: const Icon(Icons.local_taxi, color: Colors.teal),
                title: Text('Live trip — ${tripState.statusLabel}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const TripScreen()),
                ),
              ),
            ),
          Expanded(
            child: FlutterMap(
              mapController: _mapController,
              options: MapOptions(initialCenter: _islamabad, initialZoom: 13, onTap: _onMapTap),
              children: [
                TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.rahi.customer'),
                if (markers.isNotEmpty) MarkerLayer(markers: markers),
              ],
            ),
          ),
          SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Tap the map to set pickup, then destination.', style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: ServiceType.values.map((service) {
                    final selected = booking.service == service;
                    return ChoiceChip(
                      label: Text(service.label),
                      selected: selected,
                      onSelected: (_) => booking.setService(service),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 12),
                TextField(controller: _pickupLabel, decoration: const InputDecoration(labelText: 'Pickup label', hintText: 'e.g. Home, Gulberg')),
                const SizedBox(height: 8),
                TextField(controller: _destinationLabel, decoration: const InputDecoration(labelText: 'Destination label')),
                const SizedBox(height: 12),
                ElevatedButton(
                  onPressed: booking.canEstimate && booking.status != BookingStatus.estimating
                      ? booking.loadEstimate
                      : null,
                  child: booking.status == BookingStatus.estimating
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Get estimate'),
                ),
                if (booking.estimate != null) ...[
                  const SizedBox(height: 12),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Distance: ${formatDistanceKm(booking.estimate!.distanceKm)}'),
                          Text('Time: ${formatDurationMin(booking.estimate!.durationMin)}'),
                          if (booking.estimate!.suggestedFareMinor > 0)
                            Text(
                              'Suggested fare: ${formatMinor(booking.estimate!.suggestedFareMinor, booking.estimate!.currency)}',
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17),
                            )
                          else
                            const Text('Fare: not available yet — see notice below.'),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _offer,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Your offer (PKR, optional)', hintText: 'Leave blank to use suggested fare'),
                    onChanged: (value) {
                      final parsed = int.tryParse(value);
                      booking.customerOfferMinor = parsed == null ? null : parsed * 100;
                    },
                  ),
                  const SizedBox(height: 12),
                  const Text('Payment method'),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 8,
                    children: ['CASH', 'WALLET'].map((method) {
                      return ChoiceChip(
                        label: Text(method == 'CASH' ? 'Cash' : 'Wallet'),
                        selected: _paymentMethod == method,
                        onSelected: (_) =>
                            setState(() => _paymentMethod = method),
                      );
                    }).toList(),
                  ),
                  if (booking.service == ServiceType.delivery) ...[
                    const SizedBox(height: 12),
                    const Text('Delivery details (required)',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _senderName,
                      decoration: const InputDecoration(labelText: 'Sender name'),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _senderPhone,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Sender phone'),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _recipientName,
                      decoration: const InputDecoration(labelText: 'Recipient name'),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _recipientPhone,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Recipient phone'),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _packageCategory,
                      decoration: const InputDecoration(
                          labelText: 'Package category',
                          hintText: 'e.g. Documents, Food, Parcel'),
                      onChanged: (_) => setState(() {}),
                    ),
                  ],
                  const SizedBox(height: 12),
                  // Request is disabled while the fare is a preview only:
                  // a ride must never be requested on an invented fare.
                  // Delivery also needs its details filled first.
                  ElevatedButton(
                    onPressed: booking.status == BookingStatus.requesting
                        ? null
                        : (booking.estimate!.suggestedFareMinor > 0 &&
                                (booking.service != ServiceType.delivery ||
                                    _deliveryValid)
                            ? () {
                                booking.paymentMethod = _paymentMethod;
                                if (booking.service == ServiceType.delivery) {
                                  booking.deliveryDetails = {
                                    'senderName': _senderName.text.trim(),
                                    'senderPhone': _senderPhone.text.trim(),
                                    'recipientName': _recipientName.text.trim(),
                                    'recipientPhone':
                                        _recipientPhone.text.trim(),
                                    'packageCategory':
                                        _packageCategory.text.trim(),
                                  };
                                }
                                booking.requestRide();
                              }
                            : null),
                    child: booking.status == BookingStatus.requesting
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('REQUEST RIDE'),
                  ),
                ],
                if (booking.status == BookingStatus.requested &&
                    booking.requestId != null) ...[
                  const SizedBox(height: 12),
                  Text('Request sent (${booking.requestId}).'),
                  const SizedBox(height: 8),
                  ElevatedButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) =>
                            OffersScreen(requestId: booking.requestId!),
                      ),
                    ),
                    child: const Text('VIEW DRIVER OFFERS'),
                  ),
                ],
                if (booking.error != null) ...[
                  const SizedBox(height: 12),
                  Text(booking.error!, style: const TextStyle(color: Colors.red)),
                  TextButton(onPressed: booking.loadEstimate, child: const Text('Retry')),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
