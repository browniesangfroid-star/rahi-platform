import 'package:flutter/material.dart';

/// Original Rahi tokens, mirroring packages/design-tokens/tokens.json.
/// No brand colours, layouts or copy from any existing ride-hailing app.
class RahiTheme {
  static const primary = Color(0xFF0F766E);
  static const primaryDark = Color(0xFF0B5E57);
  static const accent = Color(0xFFF59E0B);
  static const danger = Color(0xFFDC2626);
  static const text = Color(0xFF0F172A);
  static const muted = Color(0xFF64748B);

  static ThemeData light() {
    return ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: primary, primary: primary),
      scaffoldBackgroundColor: const Color(0xFFF8FAFC),
      useMaterial3: true,
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(56),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
    );
  }

  static ThemeData dark() {
    return ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: primary, brightness: Brightness.dark),
      useMaterial3: true,
    );
  }
}
