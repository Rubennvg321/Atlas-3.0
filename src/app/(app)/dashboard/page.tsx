import { getDb } from "@/db";
import { getBestCustomerOfMonth, getBusinessStats, getUnlinkedAppointments } from "@/server/dashboard";
import { PageHeader } from "@/components/server-ui";
import { BusinessStatsWidget } from "@/components/widgets/business-stats";
import { BestCustomerWidget } from "@/components/widgets/best-customer";
import { UnlinkedAppointmentsWidget } from "@/components/widgets/unlinked-appointments";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ maand?: string }> }) {
  const sp = await searchParams;
  const db = getDb();
  const [stats, best, unlinked] = await Promise.all([getBusinessStats(db), getBestCustomerOfMonth(db, sp.maand), getUnlinkedAppointments(db)]);
  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" />
      <BusinessStatsWidget s={stats} />
      <BestCustomerWidget data={best} />
      <UnlinkedAppointmentsWidget items={unlinked} />
    </div>
  );
}
