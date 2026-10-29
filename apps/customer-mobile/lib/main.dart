import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'maps/maps_provider.dart';
import 'screens/activity_screen.dart';
import 'screens/auth_screen.dart';
import 'screens/home_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/wallet_screen.dart';
import 'services/api_client.dart';
import 'services/auth_service.dart';
import 'services/ride_service.dart';
import 'state/auth_state.dart';
import 'state/booking_state.dart';
import 'theme/app_theme.dart';

void main() {
  final api = ApiClient();
  runApp(RahiCustomerApp(api: api));
}

class RahiCustomerApp extends StatelessWidget {
  final ApiClient api;
  const RahiCustomerApp({super.key, required this.api});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthState(AuthService(api))..restore()),
        ChangeNotifierProvider(create: (_) => BookingState(RideService(api), OsmMapsProvider())),
      ],
      child: MaterialApp(
        title: 'Rahi',
        theme: RahiTheme.light(),
        darkTheme: RahiTheme.dark(),
        home: Consumer<AuthState>(
          builder: (context, auth, _) {
            if (auth.status == AuthStatus.unknown) {
              return const Scaffold(body: Center(child: CircularProgressIndicator()));
            }
            if (auth.status != AuthStatus.authenticated) return const AuthScreen();
            return const MainShell();
          },
        ),
      ),
    );
  }
}

/// Bottom navigation: Home, Activity, Wallet, Notifications, Profile.
class MainShell extends StatefulWidget {
  const MainShell({super.key});
  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;
  static const _screens = [
    HomeScreen(),
    ActivityScreen(),
    WalletScreen(),
    NotificationsScreen(),
    ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.map), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.history), label: 'Activity'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet), label: 'Wallet'),
          NavigationDestination(icon: Icon(Icons.notifications), label: 'Notifications'),
          NavigationDestination(icon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
