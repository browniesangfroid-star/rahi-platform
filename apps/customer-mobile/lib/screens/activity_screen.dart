import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/offer_service.dart';
import '../state/trip_state.dart';
import '../utils/fare.dart';
import 'trip_screen.dart';

/// Real activity: the customer's own ride requests from the server,
/// with status, fare and a timeline per request. A request that already
/// turned into a live trip opens the trip screen.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key});
  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  List<dynamic> _requests = [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final list = await context.read<OfferService>().listMyRequests();
      if (!mounted) return;
      setState(() {
        _requests = list;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openDetail(Map<String, dynamic> request) async {
    final id = request['id'] as String;
    final tripState = context.read<TripState>();
    if (tripState.activeRideId != null) {
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const TripScreen()),
      );
      return;
    }
    List<dynamic> timeline = [];
    try {
      timeline = await context.read<OfferService>().getTimeline(id);
    } catch (_) {}
    if (!mounted) return;
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Request ${id.substring(0, 8)}',
                style: const TextStyle(
                    fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text(
                'Status: ${(request['status'] as String?)?.replaceAll('_', ' ') ?? ''}'),
            Text('Service: ${request['serviceCode'] ?? ''}'),
            if (request['suggestedFareMinor'] != null)
              Text(
                  'Suggested fare: ${formatMinor((request['suggestedFareMinor'] as num).toInt(), 'PKR')}'),
            const SizedBox(height: 12),
            const Text('Timeline',
                style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            if (timeline.isEmpty)
              const Text('No timeline events yet.',
                  style: TextStyle(color: Colors.grey))
            else
              for (final event in timeline)
                Text('• ${(event['toStatus'] ?? event['fromStatus'] ?? '')}'),
            const SizedBox(height: 16),
            if ((request['status'] as String?) == 'SEARCHING' ||
                (request['status'] as String?) == 'OFFERING')
              ElevatedButton(
                onPressed: () async {
                  try {
                    await context.read<OfferService>().cancelRequest(id);
                    if (!context.mounted) return;
                    Navigator.of(context).pop();
                    await _load();
                  } catch (e) {
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context)
                        .showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                },
                child: const Text('Cancel request'),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 12),
              ElevatedButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (_requests.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.history, size: 48, color: Colors.grey),
              SizedBox(height: 16),
              Text('No trips yet',
                  style: TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w600)),
              SizedBox(height: 8),
              Text(
                'Your ride requests will appear here once you book your first trip.',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        itemCount: _requests.length,
        itemBuilder: (context, index) {
          final request = _requests[index] as Map<String, dynamic>;
          return ListTile(
            leading: const Icon(Icons.local_taxi),
            title: Text(
                '${request['serviceCode'] ?? ''} · ${(request['status'] as String?)?.replaceAll('_', ' ') ?? ''}'),
            subtitle: request['suggestedFareMinor'] != null
                ? Text(formatMinor(
                    (request['suggestedFareMinor'] as num).toInt(), 'PKR'))
                : null,
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _openDetail(request),
          );
        },
      ),
    );
  }
}
