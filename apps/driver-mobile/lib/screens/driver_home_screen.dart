import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import '../state/driver_state.dart';
import '../state/driver_trip_state.dart';
import 'driver_trip_screen.dart';
import 'onboarding_screen.dart';

/// Driver home: KYC gate, online switch with GPS, incoming
/// dispatched requests with the offer composer, and the active trip.
///
/// Offer rules come from the server, never the app: the driver
/// creates one LIVE offer per request (a fare is required for
/// NEGOTIATION/HYBRID, ignored for FIXED/DYNAMIC), can re-price it
/// with counter, or decline it — declining bars re-offering, so the
/// button asks for no confirmation beyond the tap itself.
class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});
  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  final _dismissed = <String>{};
  final _fareControllers = <String, TextEditingController>{};
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 10), (_) {
      final state = context.read<DriverState>();
      if (state.online) state.refresh();
      context.read<DriverTripState>().checkForNewTrip();
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    for (final controller in _fareControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  TextEditingController _fareController(String key) =>
      _fareControllers.putIfAbsent(key, () => TextEditingController());

  Future<void> _toggleOnline(DriverState state) async {
    if (state.online) {
      await state.toggleOnline();
      return;
    }
    try {
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        await Geolocator.requestPermission();
      }
      final position = await Geolocator.getCurrentPosition();
      await state.toggleOnline(lat: position.latitude, lng: position.longitude);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not get your location: $e')),
      );
    }
  }

  Future<void> _sendOffer(
      String requestId, String offerKey, bool isCounter, String? offerId) async {
    final pkr = int.tryParse(_fareController(offerKey).text.trim());
    final state = context.read<DriverState>();
    try {
      if (isCounter && offerId != null) {
        if (pkr == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Enter a fare in PKR to counter.')),
          );
          return;
        }
        await state.service.counterOffer(requestId, offerId, pkr * 100);
      } else {
        await state.service
            .createOffer(requestId, fareMinor: pkr == null ? null : pkr * 100);
      }
      await state.refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<DriverState>();
    final tripState = context.watch<DriverTripState>();
    final incoming = state.incoming
        .where((r) => !_dismissed.contains((r as Map)['id'] as String?))
        .toList();
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('KYC: ${state.kycStatus}',
              style:
                  const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(state.canAcceptRides
              ? 'You are approved with an active vehicle. Going online makes you matchable for nearby requests.'
              : 'Online mode is locked until you are APPROVED with an active approved vehicle. That gate is enforced server-side, not just in this switch.'),
          const SizedBox(height: 16),
          SwitchListTile(
            title: const Text('Online'),
            value: state.online,
            onChanged:
                state.canAcceptRides && !state.busy ? (_) => _toggleOnline(state) : null,
          ),
          if (state.error != null && state.error != 'Signed out.') ...[
            const SizedBox(height: 8),
            Text(state.error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 16),
          if (tripState.activeRideId != null)
            Card(
              color: Colors.teal.shade50,
              child: ListTile(
                leading: const Icon(Icons.local_taxi, color: Colors.teal),
                title: Text('Live trip — ${tripState.statusLabel}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => const DriverTripScreen()),
                ),
              ),
            )
          else
            OutlinedButton(
              onPressed: () =>
                  context.read<DriverTripState>().checkForNewTrip(),
              child: const Text('Check for accepted trip'),
            ),
          const SizedBox(height: 16),
          if (state.online) ...[
            Text('Incoming requests (${incoming.length})',
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            if (incoming.isEmpty)
              const Text('No dispatched requests right now.')
            else
              for (final raw in incoming)
                _RequestCard(
                  request: raw as Map<String, dynamic>,
                  fareController: _fareController(raw['id'] as String),
                  onSendOffer: (isCounter, offerId) => _sendOffer(
                      raw['id'] as String,
                      raw['id'] as String,
                      isCounter,
                      offerId),
                  onDeclineOffer: (offerId) async {
                    try {
                      await state.service.declineOffer(
                          raw['id'] as String, offerId);
                      await state.refresh();
                    } catch (e) {
                      if (!mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(e.toString())));
                    }
                  },
                  onDismiss: () => setState(
                      () => _dismissed.add(raw['id'] as String)),
                ),
            const SizedBox(height: 16),
          ],
          ElevatedButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const OnboardingScreen()),
            ),
            child: const Text('Onboarding & documents'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () async {
              await state.refresh();
              await context.read<DriverTripState>().checkForNewTrip();
            },
            child: const Text('Refresh status'),
          ),
        ],
      ),
    );
  }
}

class _RequestCard extends StatelessWidget {
  final Map<String, dynamic> request;
  final TextEditingController fareController;
  final void Function(bool isCounter, String? offerId) onSendOffer;
  final void Function(String offerId) onDeclineOffer;
  final VoidCallback onDismiss;

  const _RequestCard({
    required this.request,
    required this.fareController,
    required this.onSendOffer,
    required this.onDeclineOffer,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    final myOffer = request['myOffer'] as Map<String, dynamic>?;
    final offerFare = (myOffer?['proposedFareMinor'] as num?)?.toInt();
    final customerOffer = (request['customerOfferMinor'] as num?)?.toInt();
    final suggested = (request['suggestedFareMinor'] as num?)?.toInt();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${request['serviceCode'] ?? ''} · ${(request['id'] as String).substring(0, 8)}',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            if (customerOffer != null)
              Text('Customer offer: Rs ${customerOffer ~/ 100}'),
            if (suggested != null) Text('Suggested: Rs ${suggested ~/ 100}'),
            if (myOffer != null)
              Text(
                  'Your live offer: Rs ${offerFare != null ? offerFare ~/ 100 : '?'}'),
            const SizedBox(height: 8),
            TextField(
              controller: fareController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: myOffer == null
                    ? 'Your fare (PKR, optional for fixed fares)'
                    : 'New fare (PKR) to counter',
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => onSendOffer(
                        myOffer != null, myOffer?['id'] as String?),
                    child: Text(myOffer == null ? 'Send offer' : 'Counter'),
                  ),
                ),
                const SizedBox(width: 8),
                if (myOffer != null)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () =>
                          onDeclineOffer(myOffer['id'] as String),
                      child: const Text('Decline offer'),
                    ),
                  )
                else
                  Expanded(
                    child: OutlinedButton(
                      onPressed: onDismiss,
                      child: const Text('Ignore'),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
