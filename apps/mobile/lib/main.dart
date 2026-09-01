import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'screens/home_screen.dart';
import 'theme.dart';

void main() {
  runApp(const ProviderScope(child: ImVocesApp()));
}

class ImVocesApp extends StatelessWidget {
  const ImVocesApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ImVoces FileManager',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      home: const HomeScreen(),
    );
  }
}
