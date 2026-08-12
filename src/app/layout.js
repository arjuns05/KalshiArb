import "./globals.css";

export const metadata = {
  title: "Edge - Prediction Market Arbitrage",
  description: "Prediction market arbitrage dashboard for Kalshi and Polymarket.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
