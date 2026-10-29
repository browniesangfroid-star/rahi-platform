/// Money formatting for minor units (paisa for PKR). Integer maths only,
/// never float division on money in display logic either.
String formatMinor(int amountMinor, String currency) {
  final whole = amountMinor ~/ 100;
  final fraction = amountMinor % 100;
  final symbol = currency == 'PKR' ? 'Rs' : currency;
  if (fraction == 0) return '$symbol $whole';
  return '$symbol $whole.${fraction.toString().padLeft(2, '0')}';
}

String formatDistanceKm(double km) {
  if (km < 1) return '${(km * 1000).round()} m';
  return '${km.toStringAsFixed(1)} km';
}

String formatDurationMin(int minutes) {
  if (minutes < 60) return '$minutes min';
  return '${minutes ~/ 60}h ${minutes % 60}m';
}
