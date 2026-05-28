'use client';

import { useEffect } from 'react';

// Last-resort boundary. Catches errors thrown in the root layout itself, where
// the route-level error.tsx cannot help because the layout (and its providers,
// fonts and globals.css) failed to render. It must supply its own <html>/<body>
// and stand entirely on inline styles — Tailwind/theme tokens may be unavailable
// here.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', { digest: error.digest, message: error.message }, error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
          background: '#0b0f1a',
          color: '#e6e9ef',
        }}
      >
        <div style={{ maxWidth: '28rem', width: '100%', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>
            Algo deu errado ao carregar a aplicação
          </h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.8, margin: '0 0 1.25rem' }}>
            Ocorreu um erro inesperado. Recarregue a página — se o problema persistir, informe o
            administrador com o código abaixo.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.8rem',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: '0.5rem',
                padding: '0.5rem 0.75rem',
                margin: '0 0 1.25rem',
                wordBreak: 'break-all',
              }}
            >
              {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.6rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: '#4f7cff',
              color: '#fff',
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
