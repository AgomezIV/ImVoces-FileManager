import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../services/providers.dart';

/// Cuentas del usuario y nubes que puede conectar.
///
/// Conectar es pulsar una tarjeta e iniciar sesión con la cuenta de siempre.
/// No hay claves de API por ninguna parte: eso queda en la web, para quien
/// tenga su propio bucket.
class AccountsScreen extends ConsumerWidget {
  const AccountsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(accountsViewProvider);

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
      body: view.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('$err')),
        data: (data) {
          // Un proveedor ya conectado se sigue ofreciendo: se pueden vincular
          // varias cuentas del mismo servicio y todas salen como ubicaciones.
          final countByProvider = <String, int>{};
          for (final a in data.accounts) {
            countByProvider[a.provider] = (countByProvider[a.provider] ?? 0) + 1;
          }
          final toConnect = data.available;

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(accountsViewProvider),
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                for (final a in data.accounts)
                  ListTile(
                    leading: Icon(
                      a.managed ? Icons.workspace_premium_outlined : Icons.cloud_done_outlined,
                    ),
                    title: Row(
                      children: [
                        Flexible(child: Text(a.label, overflow: TextOverflow.ellipsis)),
                        if (a.managed) ...[
                          const SizedBox(width: 8),
                          const _Pill(text: 'incluido'),
                        ],
                      ],
                    ),
                    subtitle: Text(
                      a.quotaTotal != null
                          ? '${formatBytes(a.quotaUsed ?? 0)} de ${formatBytes(a.quotaTotal!)}'
                          : a.managed
                              ? 'Espacio incluido con tu cuenta'
                              : a.provider,
                    ),
                    trailing: a.status == 'ACTIVE'
                        ? null
                        : Chip(label: Text(a.status), visualDensity: VisualDensity.compact),
                  ),

                if (toConnect.isNotEmpty) ...[
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 24, 16, 4),
                    child: Text(
                      'Conectar una nube',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Text(
                      'Inicias sesión con tu cuenta de siempre. No necesitas claves '
                      'ni configurar nada. Puedes vincular varias cuentas del mismo '
                      'servicio.',
                    ),
                  ),
                  for (final p in toConnect)
                    _ConnectTile(
                      provider: p,
                      connected: countByProvider[p.id] ?? 0,
                      onTap: () => _connect(context, ref, p.id),
                    ),
                ],

                if (data.available.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'El servidor todavía no tiene ninguna nube configurada.',
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }

  /// El consentimiento se abre en el navegador del sistema (Custom Tabs), nunca
  /// en un WebView embebido: Google los rechaza y además no comparte sesión.
  Future<void> _connect(BuildContext context, WidgetRef ref, String providerId) async {
    try {
      final url = await ref.read(apiProvider).connectUrl(providerId);
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

class _ConnectTile extends StatelessWidget {
  const _ConnectTile({
    required this.provider,
    required this.connected,
    required this.onTap,
  });

  final AvailableProvider provider;

  /// Cuántas cuentas de este proveedor hay ya vinculadas.
  final int connected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: ListTile(
        onTap: onTap,
        leading: Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Color(provider.color).withOpacity(0.15),
            borderRadius: BorderRadius.circular(9),
          ),
          child: Text(
            provider.name.isEmpty ? '?' : provider.name.substring(0, 1),
            style: TextStyle(color: Color(provider.color), fontWeight: FontWeight.bold),
          ),
        ),
        title: Row(
          children: [
            Flexible(child: Text(provider.name, overflow: TextOverflow.ellipsis)),
            if (connected > 0) ...[
              const SizedBox(width: 8),
              _Pill(text: '$connected'),
            ],
          ],
        ),
        subtitle: Text(connected > 0 ? 'Añadir otra cuenta' : provider.tagline),
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(text, style: Theme.of(context).textTheme.labelSmall),
    );
  }
}
