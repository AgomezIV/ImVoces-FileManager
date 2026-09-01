'use client';

import { useEffect, useRef } from 'react';
import { useSession } from './SessionProvider';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: { client_id: string; callback: (res: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/**
 * Botón oficial de Google Identity Services. Devuelve un idToken que la API
 * valida contra las claves de Google: el navegador nunca decide quién eres.
 */
export function GoogleLoginButton() {
  const { loginWithIdToken } = useSession();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !ref.current) return;

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: (res) => void loginWithIdToken(res.credential),
      });
      if (ref.current) {
        window.google?.accounts.id.renderButton(ref.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          locale: 'es',
        });
      }
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, [loginWithIdToken]);

  return <div ref={ref} />;
}
