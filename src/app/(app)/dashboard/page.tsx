import { getDb } from "@/db";
import { getBusinessStats, getUnlinkedAppointments } from "@/server/dashboard";
import { PageHeader } from "@/components/server-ui";
import { BusinessStatsWidget } from "@/components/widgets/business-stats";
import { UnlinkedAppointmentsWidget } from "@/components/widgets/unlinked-appointments";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const db = getDb();
  const [stats, unlinked] = await Promise.all([getBusinessStats(db), getUnlinkedAppointments(db)]);
  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" />
      <BusinessStatsWidget s={stats} />
      <UnlinkedAppointmentsWidget items={unlinked} />
    </div>
  );
}
