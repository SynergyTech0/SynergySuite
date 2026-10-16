"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EnterpriseStatus } from "@prisma/client";
import {
  Building2,
  ChevronDown,
  Mail,
  Search,
  User,
  Users,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";

interface EnterpriseRequest {
  id: String;
  companyName: String;
  contactName: String;
  contactEmail: String;
  teamSize: String;
  message: String | undefined;
  submitter: String;
  status: EnterpriseStatus;
  createdAt: Date;
}
const possibleStatuses = ["PENDING", "DISCUSSION", "APPROVED", "REJECTED"];

interface StatusDropdownProps {
  currentStatus: string;
  statusOptions: string[];
  onStatusChange: (status: string) => void;
  isLoading?: boolean;
}

function StatusDropdown({
  currentStatus,
  statusOptions,
  onStatusChange,
  isLoading = false,
}: StatusDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-w-[140px] justify-between"
          disabled={isLoading}
        >
          <span>{currentStatus}</span>
          {isLoading ? (
            <Spinner size="sm" className="ml-2" />
          ) : (
            <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[140px]">
        {statusOptions.map((status) => (
          <DropdownMenuItem
            key={status}
            onClick={() => {
              if (status !== currentStatus && !isLoading) {
                onStatusChange(status);
              }
            }}
            className="cursor-pointer"
            disabled={isLoading}
          >
            {status}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RequestTile({
  request,
  onStatusChange,
}: {
  request: EnterpriseRequest;
  onStatusChange: (requestId: string, status: string) => void;
}) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (status: string) => {
    if (status === request.status) return;

    setIsUpdating(true);
    console.log("Updating status to", status);
    try {
      const res = await fetch("/api/enterprise/update-status/", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId: request.id, status }),
      });

      if (res.ok) {
        onStatusChange(request.id.toString(), status);
      } else {
        const errorData = await res.json();
        console.error("Failed to update status:", errorData.error || "Unknown error");
      }
    } catch (error) {
      console.error("Error updating status:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Card
      key={request.id.concat(request.companyName + "request")}
      className="border rounded p-4"
    >
      <CardHeader>
        <div className="flex items-center justify-between space-x-2 mb-2">
          <CardTitle className="flex-shrink">{request.companyName}</CardTitle>
          <div>
            {request.status === "PENDING" ? (
              <StatusDropdown
                currentStatus={request.status}
                statusOptions={possibleStatuses}
                onStatusChange={handleStatusChange}
                isLoading={isUpdating}
              />
            ) : (
              <div className="px-3 py-1.5 border rounded-md text-sm font-medium">
                {request.status}
              </div>
            )}
          </div>
        </div>
        <CardDescription>
          {"Requested on " + new Date(request.createdAt).toLocaleDateString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="font-semibold">Company Name:</p>
            <p>
              <Building2 className="w-4 h-4 inline mr-2" />{" "}
              {request.companyName}
            </p>
          </div>
          <div>
            <p className="font-semibold">Team Size:</p>
            <p>
              <Users className="w-4 h-4 inline mr-2" /> {request.teamSize}
            </p>
          </div>
          <div>
            <p className="font-semibold">Contact Name:</p>
            <p>
              <User className="w-4 h-4 inline mr-2" /> {request.contactName}
            </p>
          </div>
          <div>
            <p className="font-semibold">Contact Email:</p>
            <p>
              <Mail className="w-4 h-4 inline mr-2" /> {request.contactEmail}
            </p>
          </div>
        </div>
        {request.message && (
          <div className="md:col-span-2">
            <p className="font-semibold">Message:</p>
            <p>{request.message}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminEnterprisesRequestsPage() {
  const [requests, setRequests] = useState<EnterpriseRequest[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState("ALL");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    async function fetchRequests() {
      // Build query params
      const params = new URLSearchParams();

      if (debouncedSearchQuery.trim()) {
        params.append("companyName", debouncedSearchQuery.trim());
      }

      if (searchStatus && searchStatus !== "ALL") {
        params.append("status", searchStatus);
      }

      const queryString = params.toString();
      const url = `/api/enterprise/requests${
        queryString ? `?${queryString}` : ""
      }`;

      setIsFetching(true);
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error(
            "Failed to fetch requests:",
            res.status,
            res.statusText
          );
          setRequests([]);
          return;
        }
        const data = await res.json();
        // Ensure requests is always an array
        setRequests(Array.isArray(data?.requests) ? data.requests : []);
      } catch (error) {
        console.error("Error fetching requests:", error);
        setRequests([]);
      } finally {
        setIsFetching(false);
        setIsInitialLoading(false);
      }
    }

    fetchRequests();
  }, [debouncedSearchQuery, searchStatus]);

  const handleQueryStatusChange = (status: string) => {
    setSearchStatus(status);
  };

  const handleStatusChange = (requestId: string, status: string) => {
    if (status != searchStatus && searchStatus !== "ALL") {
      // If the new status doesn't match the current filter, remove the request from the list
      setRequests((prev) => (prev || []).filter((r) => r.id !== requestId));
      return;
    }

    setRequests((prev) => {
      const currentRequests = prev || [];
      const updated = currentRequests.map((r) =>
        r.id === requestId ? { ...r, status: status as EnterpriseStatus } : r
      ) as EnterpriseRequest[];
      const statusOrder = possibleStatuses;
      updated.sort((a, b) => {
        const aIndex = statusOrder.indexOf(a.status as unknown as string);
        const bIndex = statusOrder.indexOf(b.status as unknown as string);
        // Unknown statuses go to end
        const safeA = aIndex === -1 ? 999 : aIndex;
        const safeB = bIndex === -1 ? 999 : bIndex;
        if (safeA !== safeB) return safeA - safeB;
        // Secondary sort: newest first
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
      return updated;
    });
  };

  if (isInitialLoading) {
    return <div className="p-8">Loading...</div>;
  }

  // Ensure requests is always an array to prevent undefined errors
  const safeRequests = Array.isArray(requests) ? requests : [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="">
        <h1 className="text-3xl font-bold">Enterprise Contact Requests</h1>
        <p>Review and manage enterprise contact requests submitted by users.</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="flex w-full justify-between items-center space-x-4">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search by company name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <StatusDropdown
              currentStatus={searchStatus}
              statusOptions={["ALL", ...possibleStatuses]}
              onStatusChange={handleQueryStatusChange}
            />
          </div>
        </CardContent>
      </Card>
      <Card className="p-6 space-y-4">
        <CardContent>
          {isFetching && safeRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Spinner size="lg" />
              <p className="mt-4 text-muted-foreground">Loading requests...</p>
            </div>
          ) : safeRequests.length > 0 ? (
            <div className="flex flex-col space-y-4">
              {safeRequests.map((request) => (
                <RequestTile
                  key={request.id.toString()}
                  request={request}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No enterprise requests found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
