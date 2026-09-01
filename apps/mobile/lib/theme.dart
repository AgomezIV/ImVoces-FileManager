import 'package:flutter/material.dart';

/// Mismos tokens que `apps/web/src/app/globals.css`: web y móvil deben
/// verse como una sola aplicación.
class Tokens {
  static const brand = Color(0xFF2F6FED);
  static const ok = Color(0xFF1F9254);
  static const danger = Color(0xFFD93B3B);
  static const radius = 10.0;
}

ThemeData buildTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(
    seedColor: Tokens.brand,
    brightness: brightness,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor:
        brightness == Brightness.dark ? const Color(0xFF0F1319) : const Color(0xFFF6F7F9),
    cardTheme: CardTheme(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Tokens.radius),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
  );
}
