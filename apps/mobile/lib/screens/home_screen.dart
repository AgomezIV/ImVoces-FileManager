import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/providers.dart';
import 'accounts_screen.dart';
import 'files_screen.dart';
import 'login_screen.dart';
import 'transfers_screen.dart';

/// Tres pestañas: Archivos · Transferencias · Cuentas.
/// Todo lo demás cuelga de la primera.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);

    return session.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (err, _) => Scaffold(body: Center(child: Text('Error: $err'))),
      data: (user) {
        if (user == null) return const LoginScreen();

        return Scaffold(
          body: IndexedStack(
            index: _index,
            children: const [FilesScreen(), TransfersScreen(), AccountsScreen()],
          ),
          bottomNavigationBar: NavigationBar(
            selectedIndex: _index,
            onDestinationSelected: (i) => setState(() => _index = i),
            destinations: const [
              NavigationDestination(icon: Icon(Icons.folder_outlined), label: 'Archivos'),
              NavigationDestination(icon: Icon(Icons.swap_horiz), label: 'Transferencias'),
              NavigationDestination(icon: Icon(Icons.cloud_outlined), label: 'Cuentas'),
            ],
          ),
        );
      },
    );
  }
}
