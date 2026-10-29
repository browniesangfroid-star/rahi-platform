/// Money formatting for minor units (paisa for PKR). Integer maths
/// only, never float division on money in display logic either.
String formatMinor(int amountMinor, String currency) {
  final whole = amountMinor ~/ 100;
  final fraction = amountMinor % 100;
  final symbol = currency == 'PKR' ? 'Rs' : currency;
  if (fraction == 0) return '$symbol $whole';
  return '$symbol $whole.${fraction.toString().padLeft(2, '0')}';
}
