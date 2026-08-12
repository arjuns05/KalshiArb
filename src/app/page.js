export const dynamic = "force-dynamic";

import { loadArbitrage } from "../../lib/arb";
import LiveDashboard from "./LiveDashboard";

export default async function Home() {
  const initialResult = await loadArbitrage();
  return <LiveDashboard initialResult={initialResult} />;
}
