/// Configuración inyectada en tiempo de compilación:
/// `flutter build apk --dart-define=API_BASE_URL=https://api.tu-dominio.com`
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    // 10.0.2.2 es el host de la máquina anfitriona vista desde el emulador Android.
    defaultValue: 'http://10.0.2.2:4000',
  );

  /// Client ID de tipo *Web* del proyecto de Google Cloud. En Android el
  /// serverClientId es el que permite a la API validar el idToken.
  static const String googleServerClientId = String.fromEnvironment(
    'GOOGLE_SERVER_CLIENT_ID',
    defaultValue: '',
  );
}
