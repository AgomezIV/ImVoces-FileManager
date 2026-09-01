/// Modelos del cliente móvil. Reflejan `packages/contracts` (Zod → JSON):
/// si allí cambia un campo, aquí falla el parseo, que es lo que se quiere.

class StorageAccount {
  const StorageAccount({
    required this.id,
    required this.provider,
    required this.label,
    required this.status,
    this.quotaUsed,
    this.quotaTotal,
  });

  final String id;
  final String provider;
  final String label;
  final String status;
  final int? quotaUsed;
  final int? quotaTotal;

  factory StorageAccount.fromJson(Map<String, dynamic> json) => StorageAccount(
        id: json['id'] as String,
        provider: json['provider'] as String,
        label: json['label'] as String,
        status: json['status'] as String,
        quotaUsed: (json['quotaUsed'] as num?)?.toInt(),
        quotaTotal: (json['quotaTotal'] as num?)?.toInt(),
      );
}

class RemoteEntry {
  const RemoteEntry({
    required this.name,
    required this.path,
    required this.kind,
    required this.size,
    this.mimeType,
    this.modifiedAt,
    this.nativeId,
  });

  final String name;
  final String path;
  final String kind;
  final int size;
  final String? mimeType;
  final String? modifiedAt;
  final String? nativeId;

  bool get isFolder => kind == 'folder';

  factory RemoteEntry.fromJson(Map<String, dynamic> json) => RemoteEntry(
        name: json['name'] as String,
        path: json['path'] as String,
        kind: json['kind'] as String,
        size: (json['size'] as num?)?.toInt() ?? 0,
        mimeType: json['mimeType'] as String?,
        modifiedAt: json['modifiedAt'] as String?,
        nativeId: json['nativeId'] as String?,
      );
}

class TransferJob {
  const TransferJob({
    required this.id,
    required this.kind,
    required this.status,
    required this.totalBytes,
    required this.doneBytes,
    required this.itemsTotal,
    required this.itemsDone,
    required this.itemsFailed,
  });

  final String id;
  final String kind;
  final String status;
  final int totalBytes;
  final int doneBytes;
  final int itemsTotal;
  final int itemsDone;
  final int itemsFailed;

  bool get isActive =>
      status == 'QUEUED' || status == 'RUNNING' || status == 'EXPANDING';

  double get progress {
    if (totalBytes > 0) return (doneBytes / totalBytes).clamp(0, 1);
    if (itemsTotal > 0) return (itemsDone / itemsTotal).clamp(0, 1);
    return 0;
  }

  factory TransferJob.fromJson(Map<String, dynamic> json) => TransferJob(
        id: json['id'] as String,
        kind: json['kind'] as String,
        status: json['status'] as String,
        totalBytes: (json['totalBytes'] as num?)?.toInt() ?? 0,
        doneBytes: (json['doneBytes'] as num?)?.toInt() ?? 0,
        itemsTotal: (json['itemsTotal'] as num?)?.toInt() ?? 0,
        itemsDone: (json['itemsDone'] as num?)?.toInt() ?? 0,
        itemsFailed: (json['itemsFailed'] as num?)?.toInt() ?? 0,
      );
}

class SessionUser {
  const SessionUser({required this.id, required this.email, this.name, this.avatarUrl});

  final String id;
  final String email;
  final String? name;
  final String? avatarUrl;

  factory SessionUser.fromJson(Map<String, dynamic> json) => SessionUser(
        id: json['id'] as String,
        email: json['email'] as String,
        name: json['name'] as String?,
        avatarUrl: json['avatarUrl'] as String?,
      );
}

String formatBytes(int bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes <= 0) return '0 B';
  var value = bytes.toDouble();
  var unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return '${value >= 100 || unit == 0 ? value.round() : value.toStringAsFixed(1)} ${units[unit]}';
}
