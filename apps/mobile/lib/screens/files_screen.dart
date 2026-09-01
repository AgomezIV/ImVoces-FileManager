import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/providers.dart';
import '../widgets/send_to_sheet.dart';

/// Explorador móvil: un panel a la vez.
///
/// El doble panel de la web no cabe en un teléfono, así que el flujo es
/// seleccionar → "Enviar a…" → elegir destino. Dos toques desde la selección
/// hasta que la transferencia arranca.
class FilesScreen extends ConsumerWidget {
  const FilesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accounts = ref.watch(accountsProvider);
    final location = ref.watch(locationProvider);
    final entries = ref.watch(entriesProvider);
    final selection = ref.watch(selectionProvider);

    return Scaffold(
      appBar: AppBar(
        title: accounts.maybeWhen(
          data: (list) {
            if (list.isEmpty) return const Text('Archivos');
            final current = location.accountId ??
                (list.isNotEmpty ? list.first.id : null);
            // Fijar la primera cuenta si aún no hay ninguna elegida.
            if (location.accountId == null && current != null) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                ref.read(locationProvider.notifier).state =
                    BrowserLocation(accountId: current);
              });
            }
            return DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: list.any((a) => a.id == current) ? current : null,
                isExpanded: true,
                items: [
                  for (final a in list)
                    DropdownMenuItem(value: a.id, child: Text(a.label, overflow: TextOverflow.ellipsis)),
                ],
                onChanged: (id) => ref.read(locationProvider.notifier).state =
                    BrowserLocation(accountId: id),
              ),
            );
          },
          orElse: () => const Text('Archivos'),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.create_new_folder_outlined),
            onPressed: location.accountId == null ? null : () => _createFolder(context, ref),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(entriesProvider),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(36),
          child: _Breadcrumbs(path: location.path, ref: ref),
        ),
      ),
      body: entries.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorView(message: '$err', onRetry: () => ref.invalidate(entriesProvider)),
        data: (list) {
          if (list.isEmpty) {
            return const Center(child: Text('Esta carpeta está vacía.'));
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(entriesProvider),
            child: ListView.builder(
              itemCount: list.length,
              itemBuilder: (context, i) {
                final entry = list[i];
                final selected = selection.contains(entry.path);
                return ListTile(
                  leading: Icon(entry.isFolder ? Icons.folder : Icons.insert_drive_file_outlined),
                  title: Text(entry.name, overflow: TextOverflow.ellipsis),
                  subtitle: Text(entry.isFolder ? 'Carpeta' : formatBytes(entry.size)),
                  selected: selected,
                  trailing: Checkbox(
                    value: selected,
                    onChanged: (_) => _toggle(ref, entry.path),
                  ),
                  onTap: () {
                    if (selection.isNotEmpty) {
                      _toggle(ref, entry.path);
                    } else if (entry.isFolder) {
                      ref.read(locationProvider.notifier).state =
                          location.copyWith(path: entry.path);
                    } else {
                      _toggle(ref, entry.path);
                    }
                  },
                  onLongPress: () => _toggle(ref, entry.path),
                );
              },
            ),
          );
        },
      ),
      floatingActionButton: selection.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: () => showSendToSheet(context, ref),
              icon: const Icon(Icons.send),
              label: Text('Enviar ${selection.length}'),
            ),
      bottomSheet: selection.isEmpty
          ? null
          : _SelectionBar(
              count: selection.length,
              onClear: () => ref.read(selectionProvider.notifier).state = {},
              onDelete: () => _deleteSelection(context, ref),
            ),
    );
  }

  void _toggle(WidgetRef ref, String path) {
    final current = {...ref.read(selectionProvider)};
    if (!current.remove(path)) current.add(path);
    ref.read(selectionProvider.notifier).state = current;
  }

  Future<void> _createFolder(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nueva carpeta'),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Crear'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;

    final location = ref.read(locationProvider);
    await ref.read(apiProvider).createFolder(location.accountId!, location.path, name);
    ref.invalidate(entriesProvider);
  }

  Future<void> _deleteSelection(BuildContext context, WidgetRef ref) async {
    final selection = ref.read(selectionProvider);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('¿Eliminar ${selection.length} elemento(s)?'),
        content: const Text('En Google Drive van a la papelera; en R2 el borrado es definitivo.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Eliminar')),
        ],
      ),
    );
    if (confirmed != true) return;

    final location = ref.read(locationProvider);
    await ref.read(apiProvider).delete(location.accountId!, selection.toList());
    ref.read(selectionProvider.notifier).state = {};
    ref.invalidate(entriesProvider);
  }
}

class _Breadcrumbs extends StatelessWidget {
  const _Breadcrumbs({required this.path, required this.ref});

  final String path;
  final WidgetRef ref;

  @override
  Widget build(BuildContext context) {
    final parts = path.split('/').where((p) => p.isNotEmpty).toList();
    return SizedBox(
      height: 36,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          _crumb(context, 'Inicio', '/'),
          for (var i = 0; i < parts.length; i++) ...[
            const Icon(Icons.chevron_right, size: 16),
            _crumb(context, parts[i], '/${parts.sublist(0, i + 1).join('/')}'),
          ],
        ],
      ),
    );
  }

  Widget _crumb(BuildContext context, String label, String target) => TextButton(
        onPressed: () {
          final location = ref.read(locationProvider);
          ref.read(locationProvider.notifier).state = location.copyWith(path: target);
        },
        child: Text(label),
      );
}

class _SelectionBar extends StatelessWidget {
  const _SelectionBar({required this.count, required this.onClear, required this.onDelete});

  final int count;
  final VoidCallback onClear;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(
            children: [
              IconButton(icon: const Icon(Icons.close), onPressed: onClear),
              Expanded(child: Text('$count seleccionado(s)')),
              IconButton(icon: const Icon(Icons.delete_outline), onPressed: onDelete),
              const SizedBox(width: 72), // hueco para el FAB
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 40),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: const Text('Reintentar')),
          ],
        ),
      ),
    );
  }
}
