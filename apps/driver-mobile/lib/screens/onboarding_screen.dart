import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/driver_service.dart';
import '../state/driver_state.dart';

/// Onboarding steps: emergency contact → documents (CNIC, licence,
/// vehicle registration) → vehicle → submit for review.
/// Document types and the approval gate match the Phase 5 API exactly.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _emergencyName = TextEditingController();
  final _emergencyPhone = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _color = TextEditingController();
  final _plate = TextEditingController();
  final _year = TextEditingController(text: '2022');
  String _category = 'CAR_ECONOMY';
  String? _message;
  bool _busy = false;

  @override
  void dispose() {
    _emergencyName.dispose();
    _emergencyPhone.dispose();
    _make.dispose();
    _model.dispose();
    _color.dispose();
    _plate.dispose();
    _year.dispose();
    super.dispose();
  }

  Future<void> _upload(String type) async {
    final result = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf']);
    final path = result?.files.single.path;
    if (path == null) return;
    setState(() => _busy = true);
    try {
      await context.read<DriverState>().service.uploadDocument(type, File(path));
      setState(() => _message = '$type uploaded.');
      await context.read<DriverState>().refresh();
    } catch (e) {
      setState(() => _message = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<DriverState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Driver onboarding')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('KYC status: ${state.kycStatus}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            TextField(controller: _emergencyName, decoration: const InputDecoration(labelText: 'Emergency contact name')),
            const SizedBox(height: 8),
            TextField(controller: _emergencyPhone, decoration: const InputDecoration(labelText: 'Emergency contact phone')),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _busy ? null : () async {
                await state.register(
                  emergencyContactName: _emergencyName.text.trim().isEmpty ? null : _emergencyName.text.trim(),
                  emergencyContactPhone: _emergencyPhone.text.trim().isEmpty ? null : _emergencyPhone.text.trim(),
                );
              },
              child: const Text('Save details'),
            ),
            const SizedBox(height: 24),
            const Text('Documents (jpg, png or pdf, max 10 MB)', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            for (final type in ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION'])
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OutlinedButton(
                  onPressed: _busy ? null : () => _upload(type),
                  child: Text('Upload $type'),
                ),
              ),
            const SizedBox(height: 24),
            const Text('Vehicle', style: TextStyle(fontWeight: FontWeight.w600)),
            DropdownButton<String>(
              value: _category,
              isExpanded: true,
              items: const [
                DropdownMenuItem(value: 'BIKE', child: Text('Bike')),
                DropdownMenuItem(value: 'CAR_ECONOMY', child: Text('Car — Economy')),
                DropdownMenuItem(value: 'CAR_STANDARD', child: Text('Car — Standard')),
                DropdownMenuItem(value: 'CAR_PREMIUM', child: Text('Car — Premium')),
              ],
              onChanged: (value) => setState(() => _category = value ?? _category),
            ),
            TextField(controller: _make, decoration: const InputDecoration(labelText: 'Make')),
            TextField(controller: _model, decoration: const InputDecoration(labelText: 'Model')),
            TextField(controller: _color, decoration: const InputDecoration(labelText: 'Colour')),
            TextField(controller: _year, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Year')),
            TextField(controller: _plate, decoration: const InputDecoration(labelText: 'Registration number')),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _busy ? null : () async {
                await state.service.createVehicle({
                  'categoryCode': _category,
                  'make': _make.text.trim(),
                  'model': _model.text.trim(),
                  'year': int.tryParse(_year.text.trim()) ?? 2022,
                  'color': _color.text.trim(),
                  'registrationNumber': _plate.text.trim(),
                });
                await state.refresh();
                setState(() => _message = 'Vehicle added. An admin must approve it before activation.');
              },
              child: const Text('Add vehicle'),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _busy ? null : () async {
                try {
                  await state.submit();
                  setState(() => _message = 'Submitted for review.');
                } catch (e) {
                  setState(() => _message = e.toString());
                }
              },
              child: const Text('Submit for review'),
            ),
            if (_message != null) ...[const SizedBox(height: 16), Text(_message!)],
            if (state.error != null) ...[const SizedBox(height: 8), Text(state.error!, style: const TextStyle(color: Colors.red))],
          ],
        ),
      ),
    );
  }
}
