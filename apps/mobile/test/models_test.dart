import 'package:flutter_test/flutter_test.dart';
import 'package:imvoces_filemanager/models/models.dart';

void main() {
  group('formatBytes', () {
    test('redondea segun la magnitud', () {
      expect(formatBytes(0), '0 B');
      expect(formatBytes(512), '512 B');
      expect(formatBytes(1024), '1.0 KB');
      expect(formatBytes(1536), '1.5 KB');
      expect(formatBytes(1024 * 1024 * 3), '3.0 MB');
    });
  });

  group('TransferJob', () {
    test('el progreso usa los bytes cuando se conocen', () {
      final job = TransferJob.fromJson({
        'id': 'j1', 'kind': 'COPY', 'status': 'RUNNING',
        'totalBytes': 1000, 'doneBytes': 250,
        'itemsTotal': 4, 'itemsDone': 1, 'itemsFailed': 0,
      });
      expect(job.progress, 0.25);
      expect(job.isActive, isTrue);
    });

    test('cae a los items cuando el tamano es desconocido', () {
      final job = TransferJob.fromJson({
        'id': 'j2', 'kind': 'MOVE', 'status': 'RUNNING',
        'totalBytes': 0, 'doneBytes': 0,
        'itemsTotal': 4, 'itemsDone': 2, 'itemsFailed': 0,
      });
      expect(job.progress, 0.5);
    });

    test('un job completado no esta activo', () {
      final job = TransferJob.fromJson({
        'id': 'j3', 'kind': 'COPY', 'status': 'COMPLETED',
        'totalBytes': 10, 'doneBytes': 10,
        'itemsTotal': 1, 'itemsDone': 1, 'itemsFailed': 0,
      });
      expect(job.isActive, isFalse);
      expect(job.progress, 1.0);
    });
  });

  test('RemoteEntry distingue carpeta de archivo', () {
    final folder = RemoteEntry.fromJson({
      'name': 'docs', 'path': '/docs', 'kind': 'folder', 'size': 0,
    });
    expect(folder.isFolder, isTrue);
  });
}
