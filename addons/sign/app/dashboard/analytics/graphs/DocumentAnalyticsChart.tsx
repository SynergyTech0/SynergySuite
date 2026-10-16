"use client";

import { useRef } from "react";
import { PolarArea } from "react-chartjs-2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type DocumentAnalyticsChartProps = {
  documents: Array<{
    id: string;
    title: string;
    createdAt: Date;
    completedAt: Date | null;
    deadline: Date | null;
  }>;
};

export function DocumentAnalyticsChart({ documents }: DocumentAnalyticsChartProps) {
  const chartRef = useRef(null);

  // Calculate document completion time distribution
  const calculateDocumentCompletionData = () => {
    let res = [0, 0, 0, 0, 0, 0, 0];
    documents.forEach((doc) => {
      const actionDate = doc.completedAt ?? doc.deadline ?? null;
      if (actionDate === doc.deadline && doc.deadline && new Date(doc.deadline) < new Date()) {
        res[6] += 1; // Expired
      } else if (!actionDate) {
        res[5] += 1; // Pending
      } else {
        const timeDiff = Math.abs(
          new Date(actionDate).getTime() - new Date(doc.createdAt).getTime()
        );

        const daysAgo = Math.floor(timeDiff / (1000 * 3600 * 24));
        if (daysAgo === 0) res[0] += 1;
        else if (daysAgo < 3) res[1] += 1;
        else if (daysAgo < 7) res[2] += 1;
        else if (daysAgo < 14) res[3] += 1;
        else res[4] += 1;
      }
    });
    return res;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document Analytics</CardTitle>
        <CardDescription>The time it takes for documents to be completed</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-96 flex items-center justify-center text-gray-500">
          <PolarArea
            ref={chartRef}
            data={{
              labels: ["Day of", "<3 Days", "<7 Days", "<14 Days", "14+ Days", "Pending", "Expired"],
              datasets: [
                {
                  label: "Completion Time",
                  data: calculateDocumentCompletionData(),
                  backgroundColor: [
                    "rgba(75, 192, 192, 0.5)",
                    "rgba(54, 162, 235, 0.5)",
                    "rgba(153, 102, 255, 0.5)",
                    "rgba(255, 206, 86, 0.5)",
                    "rgba(255, 159, 64, 0.5)",
                    "rgba(55, 55, 55, 0.5)",
                    "rgba(255, 99, 132, 0.5)",
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
