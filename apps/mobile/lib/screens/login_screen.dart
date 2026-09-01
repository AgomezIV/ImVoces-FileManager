import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/providers.dart';

class LoginScreen extends ConsumerWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_sync, size: 64),
              const SizedBox(height: 16),
              Text('ImVoces FileManager', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              const Text(
                'Todos tus archivos, de todas tus nubes, en un solo sitio. '
                'Las transferencias corren en el servidor: cerrar la app no las detiene.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 28),
              FilledButton.icon(
                onPressed: () => ref.read(sessionProvider.notifier).signIn(),
                icon: const Icon(Icons.login),
                label: const Text('Continuar con Google'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
