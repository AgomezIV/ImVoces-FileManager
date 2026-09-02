import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/providers.dart';

/// Bottom-sheet de "Enviar a…": elige cuenta destino, navega hasta la carpeta
/// y confirma. Es el equivalente móvil del botón central de la web.
Future<void> showSendToSheet(BuildContext context, WidgetRef ref) async {
  final selection = ref.read(selectionProvider);
  final origin = ref.read(locationProvider);
  if (selection.isEmpty || origin.accountId == null) return;

  final accounts = (await ref.read(apiProvider).accounts()).accounts;
  if (!context.mounted) return;

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => _SendToSheet(
      accounts: accounts,
      srcAccountId: origin.accountId!,
      srcPaths: selection.toList(),
      ref: ref,
    ),
  );
}

class _SendToSheet extends StatefulWidget {
  const _SendToSheet({
    required this.accounts,
    required this.srcAccountId,
    required this.srcPaths,
    required this.ref,
  });

  final List<StorageAccount> accounts;
  final String srcAccountId;
  final List<String> srcPaths;
  final WidgetRef ref;

  @override
  State<_SendToSheet> createState() => _SendToSheetState();
}

class _SendToSheetState extends State<_SendToSheet> {
  String? _destAccountId;
  String _destPath = '/';
  List<RemoteEntry> _folders = const [];
  bool _loading = false;
  bool _move = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Se preselecciona una cuenta distinta a la de origen: copiar entre nubes
    // es el caso principal, y así el destino ya es útil de entrada.
    final other = widget.accounts.where((a) => a.id != widget.srcAccountId);
    _destAccountId = other.isNotEmpty ? other.first.id : widget.accounts.firstOrNull?.id;
    if (_destAccountId != null) _loadFolders();
  }

  Future<void> _loadFolders() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final entries = await widget.ref.read(apiProvider).list(_destAccountId!, _destPath);
      if (!mounted) return;
      setState(() => _folders = entries.where((e) => e.isFolder).toList());
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    setState(() => _loading = true);
    try {
      await widget.ref.read(apiProvider).createTransfer(
            kind: _move ? 'MOVE' : 'COPY',
            srcAccountId: widget.srcAccountId,
            srcPaths: widget.srcPaths,
            destAccountId: _destAccountId!,
            destPath: _destPath,
          );
      widget.ref.read(selectionProvider.notifier).state = {};
      widget.ref.invalidate(transfersProvider);
      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Transferencia iniciada. Sigue en marcha aunque cierres la app.'),
        ),
      );
    } catch (err) {
      if (mounted) setState(() => _error = '$err');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Enviar ${widget.srcPaths.length} elemento(s) a…',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),

          DropdownButtonFormField<String>(
            value: _destAccountId,
            decoration: const InputDecoration(labelText: 'Cuenta destino'),
            items: [
              for (final a in widget.accounts)
                DropdownMenuItem(value: a.id, child: Text(a.label, overflow: TextOverflow.ellipsis)),
            ],
            onChanged: (id) {
              setState(() {
                _destAccountId = id;
                _destPath = '/';
              });
              _loadFolders();
            },
          ),
          const SizedBox(height: 12),

          Row(
            children: [
              if (_destPath != '/')
                IconButton(
                  icon: const Icon(Icons.arrow_upward),
                  onPressed: () {
                    final idx = _destPath.lastIndexOf('/');
                    setState(() => _destPath = idx <= 0 ? '/' : _destPath.substring(0, idx));
                    _loadFolders();
                  },
                ),
              Expanded(child: Text(_destPath, overflow: TextOverflow.ellipsis)),
            ],
          ),

          SizedBox(
            height: 200,
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Text(_error!, textAlign: TextAlign.center))
                    : _folders.isEmpty
                        ? const Center(child: Text('Sin subcarpetas — se enviará aquí.'))
                        : ListView.builder(
                            itemCount: _folders.length,
                            itemBuilder: (context, i) => ListTile(
                              leading: const Icon(Icons.folder),
                              title: Text(_folders[i].name, overflow: TextOverflow.ellipsis),
                              onTap: () {
                                setState(() => _destPath = _folders[i].path);
                                _loadFolders();
                              },
                            ),
                          ),
          ),

          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _move,
            onChanged: (v) => setState(() => _move = v),
            title: const Text('Mover en lugar de copiar'),
            subtitle: const Text('El origen se borra solo tras verificar el destino.'),
          ),

          FilledButton.icon(
            onPressed: _loading || _destAccountId == null ? null : _send,
            icon: Icon(_move ? Icons.drive_file_move : Icons.copy),
            label: Text(_move ? 'Mover aquí' : 'Copiar aquí'),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
