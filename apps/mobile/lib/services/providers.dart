import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../config.dart';
import '../models/models.dart';
import 'api_client.dart';

final apiProvider = Provider<ApiClient>((ref) => ApiClient());

/// Estado de sesión. Al arrancar se intenta refrescar con el token guardado:
/// el usuario no vuelve a ver la pantalla de login en cada apertura.
class SessionNotifier extends StateNotifier<AsyncValue<SessionUser?>> {
  SessionNotifier(this._api) : super(const AsyncValue.loading()) {
    _restore();
  }

  final ApiClient _api;

  final _googleSignIn = GoogleSignIn(
    scopes: const ['email', 'profile'],
    serverClientId:
        AppConfig.googleServerClientId.isEmpty ? null : AppConfig.googleServerClientId,
  );

  Future<void> _restore() async {
    final ok = await _api.refresh();
    state = AsyncValue.data(ok ? await _api.me() : null);
  }

  Future<void> signIn() async {
    state = const AsyncValue.loading();
    try {
      final account = await _googleSignIn.signIn();
      if (account == null) {
        state = const AsyncValue.data(null); // el usuario canceló
        return;
      }
      final auth = await account.authentication;
      final idToken = auth.idToken;
      if (idToken == null) {
        throw StateError(
          'Google no devolvió idToken. Revisa el serverClientId y la huella SHA-1 del keystore.',
        );
      }
      state = AsyncValue.data(await _api.loginWithGoogle(idToken));
    } catch (err, stack) {
      state = AsyncValue.error(err, stack);
    }
  }

  Future<void> signOut() async {
    await _googleSignIn.signOut();
    await _api.logout();
    state = const AsyncValue.data(null);
  }
}

final sessionProvider =
    StateNotifierProvider<SessionNotifier, AsyncValue<SessionUser?>>(
  (ref) => SessionNotifier(ref.watch(apiProvider)),
);

final accountsProvider = FutureProvider<List<StorageAccount>>((ref) async {
  // Se recarga cuando cambia la sesión: al salir no deben quedar cuentas en pantalla.
  ref.watch(sessionProvider);
  return ref.watch(apiProvider).accounts();
});

/// Ubicación del explorador: qué cuenta y qué carpeta se está mirando.
class BrowserLocation {
  const BrowserLocation({this.accountId, this.path = '/'});

  final String? accountId;
  final String path;

  BrowserLocation copyWith({String? accountId, String? path}) =>
      BrowserLocation(accountId: accountId ?? this.accountId, path: path ?? this.path);
}

final locationProvider = StateProvider<BrowserLocation>((ref) => const BrowserLocation());

final entriesProvider = FutureProvider<List<RemoteEntry>>((ref) async {
  final location = ref.watch(locationProvider);
  if (location.accountId == null) return const [];
  return ref.watch(apiProvider).list(location.accountId!, location.path);
});

/// Selección actual dentro de la carpeta. Se vacía al navegar.
final selectionProvider = StateProvider<Set<String>>((ref) {
  ref.watch(locationProvider);
  return <String>{};
});

final transfersProvider = FutureProvider<List<TransferJob>>(
  (ref) => ref.watch(apiProvider).transfers(),
);
