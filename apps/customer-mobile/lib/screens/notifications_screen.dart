import 'package:flutter/material.dart';

/// Push notifications are not available yet: the server has no
/// notification feed, so this stays an honest empty state — never
/// sample notifications. Trip updates arrive on the trip screen and
/// support replies under Profile → Support.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.notifications_none, size: 48, color: Colors.grey),
            SizedBox(height: 16),
            Text('No notifications yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
