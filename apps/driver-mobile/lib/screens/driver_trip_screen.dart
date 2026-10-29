import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/driver_trip_state.dart';
import '../utils/fare.dart' as fare_utils;

/// Driver trip screen: every action follows the server's trip state
/// machine, and the server rejects anything out of order — so buttons
/// only appear for the current status, and server errors surface as
/// text instead of a silently dead button.
///
/// Lifecycle: DRIVER_SELECTED → en-route → arrived → PIN verification
/// → IN_PROGRESS → complete. Delivery trips complete only via the
/// recipient OTP (plus an optional photo proof), never via Complete.
class DriverTripScreen extends StatefulWidget {
  const DriverTripScreen({super.key});
  @override
  State<DriverTripScreen> createState() => _DriverTripScreenState();
}

class _DriverTripScreenState extends State<DriverTripScreen> {
  final _pin = TextEditingController();
  final _otp = TextEditingController();
  final _cancelReason = TextEditingController();
  final _sosNote = TextEditingController();
  final _ratingComment = TextEditingController();
  final _reportReason = TextEditingController();
  int _stars = 5;

  @override
  void dispose() {
    _pin.dispose();
    _otp.dispose();
    _cancelReason.dispose();
    _sosNote.dispose();
    _ratingComment.dispose();
    _reportReason.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto(DriverTripState tripState) async {
    final result = await FilePicker.platform.pickFiles(
        type: FileType.image, allowedExtensions: ['jpg', 'jpeg', 'png']);
    final path = result?.files.single.path;
    if (path == null) return;
    await tripState.deliveryPhoto(File(path));
  }

  @override
  Widget build(BuildContext context) {
    final tripState = context.watch<DriverTripState>();
    final trip = tripState.trip;
    final status = tripState.status;
    final delivery =
        trip?['delivery'] as Map<String, dynamic>?;
    final deliveryStatus = delivery?['status'] as String?;
    final fare = (trip?['finalFareMinor'] as num?)?.toInt();

    return Scaffold(
      appBar: AppBar(title: const Text('Trip')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Status: ${tripState.statusLabel}',
                style:
                    const TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
            if (fare != null) ...[
              const SizedBox(height: 4),
              Text('Fare: ${fare_utils.formatMinor(fare, 'PKR')}',
                  style: const TextStyle(fontSize: 17)),
            ],
            if (tripState.error != null) ...[
              const SizedBox(height: 8),
              Text(tripState.error!,
                  style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 20),
            if (status == 'DRIVER_SELECTED') ...[
              ElevatedButton(
                onPressed: tripState.busy ? null : tripState.enRoute,
                child: const Text("I'm on my way"),
              ),
            ],
            if (status == 'DRIVER_EN_ROUTE') ...[
              ElevatedButton(
                onPressed: tripState.busy ? null : tripState.arrived,
                child: const Text("I've arrived"),
              ),
            ],
            if (status == 'DRIVER_ARRIVED') ...[
              ElevatedButton(
                onPressed: tripState.busy ? null : tripState.beginPin,
                child: const Text('Start pickup PIN verification'),
              ),
            ],
            if (status == 'WAITING_FOR_PIN') ...[
              const Text('Ask the customer for the 4-digit pickup PIN.'),
              const SizedBox(height: 8),
              TextField(
                controller: _pin,
                keyboardType: TextInputType.number,
                maxLength: 4,
                decoration: const InputDecoration(labelText: 'Pickup PIN'),
              ),
              const SizedBox(height: 8),
              ElevatedButton(
                onPressed: tripState.busy
                    ? null
                    : () => tripState.verifyPin(_pin.text.trim()),
                child: const Text('Verify PIN & start trip'),
              ),
            ],
            if (status == 'IN_PROGRESS' && !tripState.isDelivery) ...[
              ElevatedButton(
                onPressed: tripState.busy ? null : tripState.complete,
                child: const Text('Complete trip'),
              ),
            ],
            if (status == 'IN_PROGRESS' && tripState.isDelivery) ...[
              Text('Delivery status: ${deliveryStatus ?? 'IN_TRANSIT'}'),
              const SizedBox(height: 8),
              if (deliveryStatus == null || deliveryStatus == 'IN_TRANSIT')
                ElevatedButton(
                  onPressed:
                      tripState.busy ? null : tripState.deliveryArrived,
                  child: const Text('Arrived at recipient'),
                ),
              if (deliveryStatus == 'ARRIVED') ...[
                const Text(
                    'Ask the recipient for the OTP to complete the delivery.'),
                const SizedBox(height: 8),
                TextField(
                  controller: _otp,
                  keyboardType: TextInputType.number,
                  maxLength: 4,
                  decoration:
                      const InputDecoration(labelText: 'Recipient OTP'),
                ),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: tripState.busy
                      ? null
                      : () => tripState.deliveryVerifyOtp(_otp.text.trim()),
                  child: const Text('Verify OTP & deliver'),
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: tripState.busy
                      ? null
                      : () => _pickPhoto(tripState),
                  child: const Text('Upload delivery photo proof'),
                ),
              ],
            ],
            if (!tripState.isTerminal) ...[
              const SizedBox(height: 24),
              TextField(
                controller: _cancelReason,
                decoration: const InputDecoration(
                    labelText: 'Cancel reason (required to cancel)'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: tripState.busy ||
                        _cancelReason.text.trim().isEmpty
                    ? null
                    : () =>
                        tripState.driverCancel(_cancelReason.text.trim()),
                child: const Text('Cancel trip'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: tripState.busy ? null : tripState.noShow,
                child: const Text('Customer no-show'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _sosNote,
                decoration:
                    const InputDecoration(labelText: 'SOS note (optional)'),
              ),
              const SizedBox(height: 8),
              ElevatedButton(
                style:
                    ElevatedButton.styleFrom(backgroundColor: Colors.red),
                onPressed: () => tripState.sos(
                    note: _sosNote.text.trim().isEmpty
                        ? null
                        : _sosNote.text.trim()),
                child: const Text('SOS — alert support'),
              ),
            ],
            if (status == 'COMPLETED') ...[
              const SizedBox(height: 24),
              const Text('Rate the customer',
                  style:
                      TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (i) {
                  final star = i + 1;
                  return IconButton(
                    icon: Icon(Icons.star,
                        color: star <= _stars ? Colors.amber : Colors.grey),
                    onPressed: () => setState(() => _stars = star),
                  );
                }),
              ),
              TextField(
                controller: _ratingComment,
                decoration:
                    const InputDecoration(labelText: 'Comment (optional)'),
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
                          reportReason: _reportReason.text.trim().isEmpty
                              ? null
                              : _reportReason.text.trim(),
                        ),
                child: const Text('Submit rating'),
              ),
            ],
            if (tripState.isTerminal) ...[
              const SizedBox(height: 24),
              OutlinedButton(
                onPressed: () async {
                  await tripState.clearTrip();
                  if (context.mounted) Navigator.of(context).pop();
                },
                child: const Text('Close trip'),
              ),
            ],
            const SizedBox(height: 12),
            TextButton(
              onPressed: tripState.refresh,
              child: const Text('Refresh status'),
            ),
          ],
        ),
      ),
    );
  }
}
