import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AccessCore — Permission-Aware Enterprise Knowledge System',
  description: 'Evidence-grounded enterprise RAG system with server-side authorization and disclosure controls.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
