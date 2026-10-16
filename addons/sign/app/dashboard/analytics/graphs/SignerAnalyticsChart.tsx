"use client";

import { useRef } from "react";
import { Doughnut } from "react-chartjs-2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignerStatus } from "@prisma/client";

type SignerAnalyticsChartProps = {
  documentSigners: Array<{
    status: SignerStatus;
    email: string;
    name: string;
  }>;
};

export function SignerAnalyticsChart({ documentSigners }: SignerAnalyticsChartProps) {
  const chartRef = useRef(null);

  // Calculate unique signers and their stats
  const getUniqueSigners = () => {
    const uniqueSigners = new Map<
      string,
      { name: string; signed: number; declined: number; total: number }
    >();

    documentSigners.forEach((signer) => {
      if (!uniqueSigners.has(signer.email)) {
        uniqueSigners.set(signer.email, {
          name: signer.name,
          signed: signer.status === "COMPLETED" ? 1 : 0,
          declined: signer.status === "DECLINED" ? 1 : 0,
          total: 1,
        });
      } else {
        const existing = uniqueSigners.get(signer.email);
        if (existing) {
          existing.total += 1;
          if (signer.status === "COMPLETED") existing.signed += 1;
          if (signer.status === "DECLINED") existing.declined += 1;
        }
      }
    });

    return uniqueSigners;
  };

  const uniqueSigners = getUniqueSigners();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signer Analytics</CardTitle>
        <CardDescription>Signer actions and engagement</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-96 flex items-center justify-center text-gray-500">
          <Doughnut
            ref={chartRef}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  display: false,
                },
              },
            }}
            data={{
              labels: Array.from(uniqueSigners.keys()).map(
                (key) => uniqueSigners.get(key)?.name || "Unknown"
              ),
              datasets: [
                {
                  data: (() => {
                    let res: number[] = [];
                    uniqueSigners.forEach((signer) => {
                      res.push(signer.signed);
                      res.push(signer.declined);
                      res.push(signer.total - signer.signed - signer.declined);
                    });
                    return res;
                  })(),
                  backgroundColor: ["#10b981", "#ef4444", "#4c4f66ff"],
                  label: "Signer Actions - Signed / Declined / Pending",
                },
                {
                  data: (() => {
                    let res: number[] = [];
                    uniqueSigners.forEach((signer) => {
                      res.push(signer.total);
                    });
                    return res;
                  })(),
                  backgroundColor: [
                    "#4ecdc4",
                    "#45b7d1",
                    "#feca57",
                    "#54a0ff",
                    "#96ceb4",
                    "#ff9ff3",
                    "#5f27cd",
                    "#c8d6e5",
                    "#1dd1a1",
                    "#ff6b6b",
                    "#f368e0",
                    "#576574",
                    "#00d2d3",
                    "#ee5253",
                    "#0abde3",
                    "#10ac84",
                    "#c44569",
                    "#222f3e",
                  ],
                },
              ],
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
