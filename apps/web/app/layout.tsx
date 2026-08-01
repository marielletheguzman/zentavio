import './globals.css';

export const metadata = {
  title: 'Zentavio',
  description: 'Career intelligence — what the platform believes about you, and why.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
