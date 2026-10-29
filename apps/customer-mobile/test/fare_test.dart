import 'package:flutter_test/flutter_test.dart';
import 'package:rahi_customer/utils/fare.dart';

void main() {
  test('formatMinor formats PKR minor units without floats', () {
    expect(formatMinor(45000, 'PKR'), 'Rs 450');
    expect(formatMinor(45050, 'PKR'), 'Rs 450.50');
    expect(formatMinor(0, 'PKR'), 'Rs 0');
  });

  test('formatDistanceKm switches to metres under 1 km', () {
    expect(formatDistanceKm(0.4), '400 m');
    expect(formatDistanceKm(12.34), '12.3 km');
  });
}
