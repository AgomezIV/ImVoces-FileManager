import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../services/providers.dart';

class AccountsScreen extends ConsumerWidget {
  const AccountsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accounts = ref.watch(accountsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cuentas'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Cerrar sesión',
            onPressed: () => ref.read(sessionProvider.notifier).signOut(),
          ),
        ],
      ),
      body: accounts.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('$err')),
        data: (list) => ListView(
          children: [
            for (final a in list)
              ListTile(
                leading: const Icon(Icons.cloud_done_outlined),
                title: Text(a.label),
                subtitle: Text(
                  a.quotaTotal != null
                      ? '${a.provider} · ${formatBytes(a.quotaUsed ?? 0)} de ${formatBytes(a.quotaTotal!)}'
                      : a.provider,
                ),
                trailing: a.status == 'ACTIVE'
                    ? null
                    : Chip(label: Text(a.status), visualDensity: VisualDensity.compact),
              ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.add),
              title: const Text('Conectar Google Drive'),
              subtitle: const Text('Se abre el consentimiento en el navegador'),
              onTap: () => _connectDrive(context, ref),
            ),
            const ListTile(
              leading: Icon(Icons.info_outline),
              title: Text('¿Cloudflare R2 o S3?'),
              subtitle: Text(
                'Las claves de API se dan de alta desde la web, para no escribirlas en el teléfono.',
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// El consentimiento se abre en el navegador del sistema (Custom Tabs), nunca
  /// en un WebView embebido: Google los rechaza y además no comparte sesión.
  Future<void> _connectDrive(BuildContext context, WidgetRef ref) async {
    try {
      final url = await ref.read(apiProvider).driveConnectUrl();
      final launched = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!launched && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No se pudo abrir el navegador.')),
        );
      }
    } catch (err) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$err')));
      }
    }
  }
}
