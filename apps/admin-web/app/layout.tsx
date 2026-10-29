import type { ReactNode } from 'react';

export const metadata = { description: 'Rahi operations control centre', title: 'Rahi Admin' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui, sans-serif', margin: 0 }}>{children}</body>
    </html>
  );
}
