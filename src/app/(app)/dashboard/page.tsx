import { getDb } from "@/db";
import { getBusinessStats } from "@/server/dashboard";
import { PageHeader } from "@/components/server-ui";
import { BusinessStatsWidget } from "@/components/widgets/business-stats";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const stats = await getBusinessStats(getDb());
  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" />
      <BusinessStatsWidget s={stats} />
    </div>
  );
}
