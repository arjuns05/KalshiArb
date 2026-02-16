import "./globals.css";

export const metadata = {
  title: "Kalshi x Polymarket Arb MVP",
  description: "Simple arbitrage calculator for mapped markets"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
