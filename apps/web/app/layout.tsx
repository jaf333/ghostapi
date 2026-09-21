import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'GhostAPI',
  description: 'Turn web apps into agent-native operations.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <a href="/" className="wordmark">
              GhostAPI
            </a>
            <span className="tagline">Turn web apps into agent-native operations.</span>
            <nav>
              <a href="/">Targets</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
