import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { NotepadText, Plus } from "lucide-react";
import Link from "next/link";
import EnterpriseList from "@/components/admin/enterprise-list";

export const dynamic = "force-dynamic";

export default async function EnterprisesPage() {
  const pendingRequests = await prisma.enterpriseRequests.count({
    where: { status: "PENDING" },
  });

  const enterprises = await prisma.enterpriseAccount.findMany({
    include: {
      _count: {
        select: {
          users: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const serializedEnterprises = enterprises.map((enterprise) => ({
    id: enterprise.id,
    name: enterprise.name,
    domain: enterprise.domain,
    contactEmail: enterprise.contactEmail,
    customPricing: enterprise.customPricing
      ? parseFloat(enterprise.customPricing)
      : null,
    notes: enterprise.notes,
    isActive: enterprise.isActive,
    _count: {
      users: enterprise._count.users,
    },
  }));

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Enterprise Management
          </h1>
          <p className="text-gray-600">
            Manage enterprise accounts and their settings
          </p>
        </div>
        <div>
          <Link className="px-2" href="/admin/enterprises/requests">
            <Button>
              <NotepadText className="h-4 w-4 mr-2" />
              Requests
              {pendingRequests > 0 && (
                <Badge className="ml-2" variant="secondary">
                  {pendingRequests}
                </Badge>
              )}
            </Button>
          </Link>

          <Link href="/admin/enterprises/create">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Enterprise
            </Button>
          </Link>
        </div>
      </div>

      <EnterpriseList initialEnterprises={serializedEnterprises} />
    </div>
  );
}
