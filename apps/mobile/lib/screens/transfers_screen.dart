import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/providers.dart';

/// Lista de transferencias. Se refresca sola mientras haya alguna activa:
/// como corren en el servidor, siguen avanzando aunque la app estuviera cerrada.
class TransfersScreen extends ConsumerStatefulWidget {
  const TransfersScreen({super.key});

  @override
  ConsumerState<TransfersScreen> createState() => _TransfersScreenState();
}

class _TransfersScreenState extends ConsumerState<TransfersScreen> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 4), (_) {
      final jobs = ref.read(transfersProvider).valueOrNull ?? const <TransferJob>[];
      if (jobs.any((j) => j.isActive)) ref.invalidate(transfersProvider);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final transfers = ref.watch(transfersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Transferencias')),
      body: transfers.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('$err')),
        data: (jobs) {
          if (jobs.isEmpty) {
            return const Center(child: Text('Todavía no has hecho ninguna transferencia.'));
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(transfersProvider),
            child: ListView.builder(
              itemCount: jobs.length,
              itemBuilder: (context, i) => _JobTile(job: jobs[i], ref: ref),
            ),
          );
        },
      ),
    );
  }
}

class _JobTile extends StatelessWidget {
  const _JobTile({required this.job, required this.ref});

  final TransferJob job;
  final WidgetRef ref;

  static const _labels = {
    'QUEUED': 'En cola',
    'EXPANDING': 'Leyendo carpetas',
    'RUNNING': 'Transfiriendo',
    'COMPLETED': 'Completada',
    'COMPLETED_WITH_ERRORS': 'Completada con errores',
    'FAILED': 'Fallida',
    'CANCELLED': 'Cancelada',
  };

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${job.kind == 'MOVE' ? 'Mover' : 'Copiar'} · ${_labels[job.status] ?? job.status}'),
                Text('${job.itemsDone}/${job.itemsTotal}'),
              ],
            ),
            const SizedBox(height: 10),
            LinearProgressIndicator(
              value: job.isActive && job.progress == 0 ? null : job.progress,
              color: job.itemsFailed > 0 ? Theme.of(context).colorScheme.error : null,
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    '${formatBytes(job.doneBytes)} / ${formatBytes(job.totalBytes)}'
                    '${job.itemsFailed > 0 ? ' · ${job.itemsFailed} con error' : ''}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                if (job.isActive)
                  TextButton(
                    onPressed: () async {
                      await ref.read(apiProvider).cancelTransfer(job.id);
                      ref.invalidate(transfersProvider);
                    },
                    child: const Text('Cancelar'),
                  )
                else if (job.itemsFailed > 0)
                  TextButton(
                    onPressed: () async {
                      await ref.read(apiProvider).retryTransfer(job.id);
                      ref.invalidate(transfersProvider);
                    },
                    child: const Text('Reintentar'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
