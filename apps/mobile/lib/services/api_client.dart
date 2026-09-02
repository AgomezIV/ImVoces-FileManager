import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../config.dart';
import '../models/models.dart';

/// Cliente de la API.
///
/// El refresh token se guarda en `flutter_secure_storage` (Keystore de Android),
/// nunca en SharedPreferences. El access token vive solo en memoria: si la app
/// muere, se recupera con el refresh.
class ApiClient {
  ApiClient() : _dio = Dio(BaseOptions(baseUrl: AppConfig.apiBaseUrl)) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (_accessToken != null) {
            options.headers['Authorization'] = 'Bearer $_accessToken';
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          // Un 401 se resuelve refrescando una vez; si vuelve a fallar, hay que
          // volver a iniciar sesión.
          final isRetry = error.requestOptions.extra['retried'] == true;
          if (error.response?.statusCode == 401 && !isRetry) {
            if (await refresh()) {
              final options = error.requestOptions..extra['retried'] = true;
              options.headers['Authorization'] = 'Bearer $_accessToken';
              try {
                handler.resolve(await _dio.fetch<dynamic>(options));
                return;
              } on DioException catch (e) {
                handler.next(e);
                return;
              }
            }
          }
          handler.next(error);
        },
      ),
    );
  }

  final Dio _dio;
  final _storage = const FlutterSecureStorage();
  String? _accessToken;

  static const _refreshKey = 'imv_refresh_token';

  Future<void> _saveRefresh(String? token) async {
    if (token == null) {
      await _storage.delete(key: _refreshKey);
    } else {
      await _storage.write(key: _refreshKey, value: token);
    }
  }

  /// Canjea el idToken de Google Sign-In por una sesión propia.
  Future<SessionUser> loginWithGoogle(String idToken, {String device = 'android'}) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/auth/google',
      data: {'idToken': idToken, 'device': device},
    );
    final data = res.data!;
    _accessToken = data['accessToken'] as String;
    await _saveRefresh(data['refreshToken'] as String?);
    return SessionUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<bool> refresh() async {
    final stored = await _storage.read(key: _refreshKey);
    if (stored == null) return false;
    try {
      final res = await _dio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': stored},
        options: Options(extra: {'retried': true}),
      );
      final data = res.data!;
      _accessToken = data['accessToken'] as String;
      await _saveRefresh(data['refreshToken'] as String?);
      return true;
    } on DioException {
      await _saveRefresh(null);
      _accessToken = null;
      return false;
    }
  }

  Future<SessionUser?> me() async {
    try {
      final res = await _dio.get<Map<String, dynamic>>('/auth/me');
      return SessionUser.fromJson(res.data!);
    } on DioException {
      return null;
    }
  }

  Future<void> logout() async {
    final stored = await _storage.read(key: _refreshKey);
    await _dio
        .post<void>('/auth/logout', data: {'refreshToken': stored})
        .catchError((_) => Response<void>(requestOptions: RequestOptions()));
    _accessToken = null;
    await _saveRefresh(null);
  }

  Future<AccountsView> accounts() async {
    final res = await _dio.get<Map<String, dynamic>>('/accounts');
    return AccountsView.fromJson(res.data!);
  }

  /// URL de consentimiento del proveedor. El usuario solo verá su login.
  Future<String> connectUrl(String provider) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/accounts/${provider.toLowerCase()}/connect',
    );
    return res.data!['authUrl'] as String;
  }

  Future<List<RemoteEntry>> list(String accountId, String path) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/fs/list',
      queryParameters: {'accountId': accountId, 'path': path},
    );
    return (res.data!['entries'] as List<dynamic>)
        .map((e) => RemoteEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> createFolder(String accountId, String parentPath, String name) =>
      _dio.post<void>('/fs/folder',
          data: {'accountId': accountId, 'parentPath': parentPath, 'name': name});

  Future<void> delete(String accountId, List<String> paths) =>
      _dio.delete<void>('/fs', data: {'accountId': accountId, 'paths': paths});

  /// El "Enviar a…": una sola llamada con la selección tal cual.
  Future<TransferJob> createTransfer({
    required String kind,
    required String srcAccountId,
    required List<String> srcPaths,
    required String destAccountId,
    required String destPath,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>('/transfers', data: {
      'kind': kind,
      'onConflict': 'rename',
      'items': [
        for (final path in srcPaths)
          {
            'src': {'accountId': srcAccountId, 'path': path},
            'dest': {
              'accountId': destAccountId,
              'path': '${destPath == '/' ? '' : destPath}/${path.split('/').last}',
            },
          },
      ],
    });
    return TransferJob.fromJson(res.data!);
  }

  Future<List<TransferJob>> transfers() async {
    final res = await _dio.get<Map<String, dynamic>>('/transfers');
    return (res.data!['jobs'] as List<dynamic>)
        .map((e) => TransferJob.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<TransferJob> transfer(String id) async {
    final res = await _dio.get<Map<String, dynamic>>('/transfers/$id');
    return TransferJob.fromJson(res.data!);
  }

  Future<void> cancelTransfer(String id) => _dio.post<void>('/transfers/$id/cancel');
  Future<void> retryTransfer(String id) => _dio.post<void>('/transfers/$id/retry');

  /// Progreso en vivo por SSE.
  ///
  /// La transferencia corre en el servidor, así que esto es solo la ventana que
  /// la mira: cerrar la app no la cancela.
  Stream<Map<String, dynamic>> jobEvents(String id) async* {
    final res = await _dio.get<ResponseBody>(
      '/transfers/$id/events',
      options: Options(responseType: ResponseType.stream, headers: {'Accept': 'text/event-stream'}),
    );
    final lines = res.data!.stream
        .cast<List<int>>()
        .transform(utf8.decoder)
        .transform(const LineSplitter());

    await for (final line in lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        yield jsonDecode(line.substring(6)) as Map<String, dynamic>;
      } on FormatException {
        // un evento malformado no debe cortar el stream
      }
    }
  }
}
