'use client';

import { useEffect, useState } from 'react';
import { useSession } from "@/lib/session-client";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CreditCard, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 10;

export function InvoiceHistory() {
  const { data: session } = useSession();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [currentCursorIndex, setCurrentCursorIndex] = useState(0);
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<string>('all');
  const { toast } = useToast();

  useEffect(() => {
    const fetchInvoices = async () => {
      if (!session?.user) return;

      setInvoicesLoading(true);
      try {
        const currentCursor = cursorHistory[currentCursorIndex];
        const typeParam = invoiceTypeFilter !== 'all' ? `&type=${encodeURIComponent(invoiceTypeFilter)}` : '';
        const url = currentCursor
          ? `/api/billing/invoices?limit=${PAGE_SIZE}&starting_after=${currentCursor}${typeParam}`
          : `/api/billing/invoices?limit=${PAGE_SIZE}${typeParam}`;
          
        const response = await fetch(url);
        if (!response.ok) {
          console.error('Failed to fetch invoices');
          return;
        }

        const data = await response.json();
        setInvoices(data.invoices);
        setNextCursor(data.nextCursor);
      } catch (error) {
        console.error('Error fetching invoices:', error);
      } finally {
        setInvoicesLoading(false);
      }
    };

    fetchInvoices();
  }, [session, currentCursorIndex, cursorHistory, invoiceTypeFilter]);

  const handleDownloadInvoice = async (invoiceId: string, invoicePdf: string | null, hostedUrl: string | null) => {
    if (invoicePdf) {
      window.open(invoicePdf, '_blank');
    } else if (hostedUrl) {
      window.open(hostedUrl, '_blank');
    } else {
      toast({
        title: 'Error',
        description: 'Invoice download not available',
        variant: 'destructive',
      });
    }
  };

  const handleNextPage = () => {
    if (nextCursor) {
      const newIndex = currentCursorIndex + 1;
      if (newIndex >= cursorHistory.length) {
        setCursorHistory([...cursorHistory, nextCursor]);
      }
      setCurrentCursorIndex(newIndex);
    }
  };

  const handlePreviousPage = () => {
    if (currentCursorIndex > 0) {
      setCurrentCursorIndex(currentCursorIndex - 1);
    }
  };

  const handleFilterChange = (value: string) => {
    setInvoiceTypeFilter(value);
    setCursorHistory([null]);
    setCurrentCursorIndex(0);
    setNextCursor(null);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Billing History</CardTitle>
            <CardDescription>View and download your past invoices</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Filter by:</span>
            <Select value={invoiceTypeFilter} onValueChange={handleFilterChange}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="New Subscription">New Subscription</SelectItem>
                <SelectItem value="Subscription Renewal">Subscription Renewal</SelectItem>
                <SelectItem value="Subscription Update">Subscription Update</SelectItem>
                <SelectItem value="Upgrade">Upgrade</SelectItem>
                <SelectItem value="Downgrade">Downgrade</SelectItem>
                <SelectItem value="Payment">Payment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {invoicesLoading ? (
          <div className="space-y-4">
            {[...Array(PAGE_SIZE).keys()].map((i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <div className="flex items-center space-x-4">
                  <div className="animate-pulse bg-gray-200 w-10 h-10 rounded-lg"></div>
                  <div className="space-y-2">
                    <div className="animate-pulse bg-gray-200 w-40 h-4 rounded"></div>
                    <div className="animate-pulse bg-gray-200 w-60 h-3 rounded"></div>
                  </div>
                </div>
                <div className="animate-pulse bg-gray-200 w-20 h-8 rounded"></div>
              </div>
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No billing history available yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {invoices.map((invoice, index) => (
              <div key={invoice.id}>
                {index > 0 && <Separator />}
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center space-x-4">
                    <div className="bg-gray-100 p-2 rounded-lg">
                      <CreditCard className="w-5 h-5 text-gray-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{invoice.description}</p>
                      <p className="text-sm text-gray-600">
                        {format(new Date(invoice.date), 'PPP')} • {invoice.number || invoice.id}
                      </p>
                      {invoice.type && invoice.type !== 'Payment' && (
                        <Badge variant="secondary" className="mt-1 text-xs">
                          {invoice.type}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">
                        ${invoice.amount} {invoice.currency}
                      </p>
                      <Badge 
                        variant="outline" 
                        className={invoice.paid 
                          ? "text-green-600 border-green-600" 
                          : "text-yellow-600 border-yellow-600"
                        }
                      >
                        {invoice.status}
                      </Badge>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleDownloadInvoice(
                        invoice.id, 
                        invoice.invoicePdf, 
                        invoice.hostedInvoiceUrl
                      )}
                      disabled={!invoice.invoicePdf && !invoice.hostedInvoiceUrl}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {!invoicesLoading && invoices.length > 0 && (
        <CardFooter className="flex justify-between items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePreviousPage}
            disabled={currentCursorIndex === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-gray-600">Page {currentCursorIndex + 1}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNextPage}
            disabled={!nextCursor}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
