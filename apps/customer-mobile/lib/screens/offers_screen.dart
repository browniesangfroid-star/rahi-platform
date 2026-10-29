import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/offer_service.dart';
import '../state/trip_state.dart';
import '../utils/fare.dart';
import 'trip_screen.dart';

/// Offers for one ride request, polled every 8 seconds while the
/// request is still open. The customer accepts exactly one offer;
/// every fare shown here comes from the server, never from the app.
///
/// A request expires 5 minutes after creation, so this screen also
/// surfaces expiry/cancellation plainly instead of polling forever.
class OffersScreen extends StatefulWidget {
  final String requestId;
  const OffersScreen({super.key, required this.requestId});

  @override
  State<OffersScreen> createState() => _OffersScreenState();
}

class _OffersScreenState extends State<OffersScreen> {
  List<dynamic> _offers = [];
  String? _requestStatus;
  String? _error;
  bool _busy = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 8), (_) => _load());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final offers = context.read<OfferService>();
      final request = await offers.getRequest(widget.requestId);
      final list = await offers.listOffers(widget.requestId);
      if (!mounted) return;
      setState(() {
        _requestStatus = request['status'] as String?;
        _offers = list;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  bool get _requestOpen =>
      _requestStatus == 'SEARCHING' || _requestStatus == 'OFFERING';

  Future<void> _accept(Map<String, dynamic> offer) async {
    setState(() => _busy = true);
    try {
      final offers = context.read<OfferService>();
      final data =
          await offers.acceptOffer(widget.requestId, offer['id'] as String);
      if (!mounted) return;
      _poll?.cancel();
      final tripState = context.read<TripState>();
      await tripState.startFromAccept(data);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const TripScreen()),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancelRequest() async {
    setState(() => _busy = true);
    try {
      await context.read<OfferService>().cancelRequest(widget.requestId);
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final live = _offers.where((o) => o['status'] == 'LIVE').toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Driver offers')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (_requestStatus != null)
              Text('Request: ${_requestStatus!.replaceAll('_', ' ')}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(
              _requestOpen
                  ? 'Drivers nearby are sending offers. Accept one to start your trip.'
                  : 'This request is no longer open for offers.',
              style: const TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 12),
            ],
            Expanded(
              child: live.isEmpty
                  ? const Center(
                      child: Text(
                        'No offers yet — drivers have 5 minutes from dispatch.\nKeep this screen open.',
                        textAlign: TextAlign.center,
                      ),
                    )
                  : ListView.builder(
                      itemCount: live.length,
                      itemBuilder: (context, index) {
                        final offer = live[index] as Map<String, dynamic>;
                        final fare = (offer['proposedFareMinor'] as num?)?.toInt() ?? 0;
                        final rating = offer['driverRating'];
                        final vehicle = offer['vehicleCategory'] as String?;
                        return Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(formatMinor(fare, 'PKR'),
                                    style: const TextStyle(
                                        fontSize: 20, fontWeight: FontWeight.bold)),
                                const SizedBox(height: 4),
                                Text([
                                  if (rating != null) '★ $rating driver rating',
                                  if (vehicle != null) vehicle.replaceAll('_', ' '),
                                ].join(' · ')),
                                const SizedBox(height: 12),
                                ElevatedButton(
                                  onPressed: _busy ? null : () => _accept(offer),
                                  child: const Text('ACCEPT THIS OFFER'),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
            if (_requestOpen) ...[
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: _busy ? null : _cancelRequest,
                child: const Text('Cancel request'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
