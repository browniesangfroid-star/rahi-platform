import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'screens/driver_auth_screen.dart';
import 'screens/driver_home_screen.dart';
import 'screens/driver_wallet_screen.dart';
import 'screens/onboarding_screen.dart';
import 'services/driver_service.dart';
import 'services/tracking_service.dart';
import 'state/driver_state.dart';
import 'state/driver_trip_state.dart';

void main() {
  final service = DriverService();
  runApp(MultiProvider(
    providers: [
      Provider<DriverService>.value(value: service),
      ChangeNotifierProvider(create: (_) => DriverState(service)..refresh()),
      ChangeNotifierProvider(
          create: (_) =>
              DriverTripState(service, DriverTrackingService())..restore()),
    ],
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
        home: DriverAuthScreen(onVerified: () {
          state.refresh();
          context.read<DriverTripState>().restore();
        }),
      );
    }
    return MaterialApp(
      title: 'Rahi Driver',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0F766E)),
        useMaterial3: true,
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF0F766E),
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(56),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12)),
            textStyle:
                const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        ),
      ),
      home: const DriverShell(),
    );
  }
}

/// Bottom navigation: Home, Wallet, Account (KYC + onboarding + logout).
class DriverShell extends StatefulWidget {
  const DriverShell({super.key});
  @override
  State<DriverShell> createState() => _DriverShellState();
}

class _DriverShellState extends State<DriverShell> {
  int _index = 0;
  static const _screens = [
    DriverHomeScreen(),
    DriverWalletScreen(),
    _AccountScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rahi Driver')),
      body: _screens[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(
              icon: Icon(Icons.account_balance_wallet), label: 'Wallet'),
          NavigationDestination(icon: Icon(Icons.person), label: 'Account'),
        ],
      ),
    );
  }
}

class _AccountScreen extends StatelessWidget {
  const _AccountScreen();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<DriverState>();
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
              ? 'Approved with an active approved vehicle.'
              : 'Approval needs an APPROVED KYC profile and an active approved vehicle.'),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const OnboardingScreen()),
            ),
            child: const Text('Onboarding & documents'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: state.refresh,
            child: const Text('Refresh status'),
          ),
          const SizedBox(height: 24),
          OutlinedButton(
            onPressed: () async {
              await context.read<DriverTripState>().clearTrip();
              await state.logout();
            },
            child: const Text('Log out'),
          ),
          if (state.error != null && state.error != 'Signed out.') ...[
            const SizedBox(height: 12),
            Text(state.error!, style: const TextStyle(color: Colors.red)),
          ],
        ],
      ),
    );
  }
}
