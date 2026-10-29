import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'screens/driver_auth_screen.dart';
import 'screens/onboarding_screen.dart';
import 'services/driver_service.dart';
import 'state/driver_state.dart';

void main() {
  runApp(ChangeNotifierProvider(
    create: (_) => DriverState(DriverService())..refresh(),
    child: const RahiDriverApp(),
  ));
}

class RahiDriverApp extends StatelessWidget {
  const RahiDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<DriverState>();
    final needsAuth = state.kycStatus == 'UNKNOWN' && state.error != null;
    if (needsAuth) {
      return MaterialApp(
        title: 'Rahi Driver',
        home: DriverAuthScreen(onVerified: () => state.refresh()),
      );
    }
    return MaterialApp(
      title: 'Rahi Driver',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0F766E)),
        useMaterial3: true,
      ),
      home: Scaffold(
        appBar: AppBar(title: const Text('Rahi Driver')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('KYC: ${state.kycStatus}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(state.canAcceptRides
                  ? 'You are approved with an active vehicle. Going online makes you matchable for nearby requests.'
                  : 'Online mode is locked until you are APPROVED with an active approved vehicle. '
                      'That gate is enforced server-side, not just in this switch.'),
              const SizedBox(height: 16),
              // The switch calls the real server endpoints (Phase 7).
              // GPS pings land in Phase 9; until then the server reuses
              // the driver's last location, and refuses online with none.
              SwitchListTile(
                title: const Text('Online'),
                value: state.online,
                onChanged: state.canAcceptRides && !state.busy ? (_) => state.toggleOnline() : null,
              ),
              const SizedBox(height: 16),
              if (state.online) ...[
                Text('Incoming requests (${state.incoming.length})',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                if (state.incoming.isEmpty)
                  const Text('No dispatched requests right now. Offer accept/counter UI arrives with the live-trip screens in Phase 10.')
                else
                  for (final req in state.incoming)
                    ListTile(
                      title: Text('${req['serviceCode']} · ${(req['id'] as String).substring(0, 8)}'),
                      subtitle: Text(req['myOffer'] != null
                          ? 'Your live offer: ${req['myOffer']['proposedFareMinor']} minor units'
                          : 'No offer sent yet'),
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
              OutlinedButton(onPressed: state.refresh, child: const Text('Refresh status')),
              if (state.error != null) ...[const SizedBox(height: 12), Text(state.error!, style: const TextStyle(color: Colors.red))],
            ],
          ),
        ),
      ),
    );
  }
}
