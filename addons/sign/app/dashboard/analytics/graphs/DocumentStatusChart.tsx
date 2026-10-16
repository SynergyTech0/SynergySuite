"use client";

import { useRef } from "react";
import { Doughnut } from "react-chartjs-2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type DocumentStatusChartProps = {
  signerStatusAggregation: Record<string, Record<string, number>>;
};

export function DocumentStatusChart({ signerStatusAggregation }: DocumentStatusChartProps) {
  const chartRef = useRef(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document Status Distribution</CardTitle>
        <CardDescription>Overview of all document statuses</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80 flex items-center justify-center text-gray-500">
          <Doughnut
            ref={chartRef}
            data={{
              labels: ["Pending", "In Progress", "Completed", "Declined"],
              datasets: [
                {
                  data: [
                    // Consider a document in "Pending" if all signers are pending
                    Object.values(signerStatusAggregation || {}).filter(
                      (signerStats) => signerStats["PENDING"] === signerStats["total"]
                    ).length,
                    // Count documents where at least one signer is pending
                    Object.values(signerStatusAggregation || {}).filter(
                      (signerStats) => signerStats["PENDING"] < signerStats["total"]
                    ).length,
                    // Count documents where all signers are completed
                    Object.values(signerStatusAggregation || {}).filter(
                      (signerStats) => signerStats["COMPLETED"] === signerStats["total"]
                    ).length,
                    // Count documents where at least one signer has declined
                    Object.values(signerStatusAggregation || {}).filter(
                      (signerStats) => signerStats["DECLINED"] > 0
                    ).length,
                  ],
                  backgroundColor: ["#4c4f66ff", "#fdbe2cff", "#10b981", "#ef4444"],
                },
              ],
            }}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  position: "right" as const,
                },
              },
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
