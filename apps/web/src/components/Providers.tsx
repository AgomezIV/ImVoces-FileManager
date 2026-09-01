'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { SessionProvider } from './SessionProvider';
import { TransfersProvider } from './TransfersProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Los listados remotos cuestan cuota del proveedor: no se refrescan al enfocar.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <TransfersProvider>{children}</TransfersProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
