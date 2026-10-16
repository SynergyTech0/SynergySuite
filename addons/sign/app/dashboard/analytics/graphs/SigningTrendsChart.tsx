"use client";

import { useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SignerStatus } from "@prisma/client";

type SigningTrendsChartProps = {
  documentSigners: Array<{
    status: SignerStatus;
    signedAt: Date | null;
    declinedAt: Date | null;
    createdAt: Date;
  }>;
};

export function SigningTrendsChart({ documentSigners }: SigningTrendsChartProps) {
  const chartRef = useRef(null);
  const [chartDays, setChartDays] = useState(7);

  // Helper function to generate date range
  const getDates = (days: number) => {
    return Array.from({ length: days }, (_, i) => i + 1).map((day) => {
      let targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - (days - day));
      return targetDate;
    });
  };

  const dates = getDates(chartDays);

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center w-full">
          <CardTitle>Signing Trends</CardTitle>
          <div className="flex space-x-2">
            <Button
              variant={chartDays === 7 ? "default" : "outline"}
              size="sm"
              onClick={() => setChartDays(7)}
            >
              Last 7 Days
            </Button>
            <Button
              variant={chartDays === 30 ? "default" : "outline"}
              size="sm"
              onClick={() => setChartDays(30)}
            >
              Last 30 Days
            </Button>
          </div>
        </div>
        <CardDescription>Documents signed over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 flex items-center justify-center text-gray-500">
          <Line
            ref={chartRef}
            data={{
              labels: dates.map((date) => date.toLocaleDateString()),
              datasets: [
                {
                  label: "Signers Declined",
                  data: dates.map((date) => {
                    return documentSigners.filter((signer) => {
                      if (!signer.declinedAt) return false;
                      return new Date(signer.declinedAt) <= date;
                    }).length;
                  }),
                  borderColor: "#ef4444",
                  backgroundColor: "#ef4444",
                  fill: false,
                },
                {
                  label: "Signers Signed",
                  data: dates.map((date) => {
                    return documentSigners.filter((signer) => {
                      if (!signer.signedAt) return false;
                      return new Date(signer.signedAt) <= date;
                    }).length;
                  }),
                  borderColor: "#10b981",
                  backgroundColor: "#10b981",
                  fill: false,
                },
                {
                  label: "Signers Invited",
                  data: dates.map((date) => {
                    return documentSigners.filter((signer) => {
                      if (!signer.createdAt) return false;
                      return new Date(signer.createdAt) <= date;
                    }).length;
                  }),
                  borderColor: "#275bdfee",
                  backgroundColor: "#c5d2f7ff",
                  fill: true,
                },
              ],
            }}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  position: "top" as const,
                },
              },
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
