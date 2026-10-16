"use client";

import { PolarArea } from "react-chartjs-2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignerStatus } from "@prisma/client";

type CompletionTimeChartProps = {
  documentSigners: Array<{
    status: SignerStatus;
    signedAt: Date | null;
    declinedAt: Date | null;
    createdAt: Date;
  }>;
};

export function CompletionTimeChart({ documentSigners }: CompletionTimeChartProps) {
  // Calculate completion time buckets
  const calculateCompletionData = () => {
    let res = [0, 0, 0, 0, 0, 0];
    documentSigners.forEach((signer) => {
      const actionDate = signer.signedAt ?? signer.declinedAt ?? null;
      if (!actionDate) {
        res[5] += 1;
        return;
      }

      const timeDiff = Math.abs(
        new Date(actionDate).getTime() - new Date(signer.createdAt).getTime()
      );

      const daysAgo = Math.ceil(timeDiff / (1000 * 3600 * 24));
      if (daysAgo === 0) res[0] += 1;
      else if (daysAgo < 3) res[1] += 1;
      else if (daysAgo < 7) res[2] += 1;
      else if (daysAgo < 14) res[3] += 1;
      else res[4] += 1;
    });
    return res;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Completion Time</CardTitle>
        <CardDescription>Time taken to complete documents</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 flex items-center justify-center text-gray-500">
          <PolarArea
            data={{
              labels: ["Day of", "<3 Days", "<7 Days", "<14 Days", "14+ Days", "No Action"],
              datasets: [
                {
                  label: "Completion Time",
                  data: calculateCompletionData(),
                  backgroundColor: [
                    "rgba(75, 192, 192, 0.5)",
                    "rgba(54, 162, 235, 0.5)",
                    "rgba(153, 102, 255, 0.5)",
                    "rgba(255, 206, 86, 0.5)",
                    "rgba(255, 159, 64, 0.5)",
                    "rgba(255, 99, 132, 0.5)",
                    "rgba(55, 55, 55, 0.5)",
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
