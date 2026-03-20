'use client';

import {
  Database,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Package,
  Users,
  Receipt,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDemoState } from '@/lib/store';

function statusColor(status: string) {
  switch (status) {
    case 'delivered':
      return 'bg-green-500/10 text-green-600 dark:text-green-400';
    case 'shipped':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'processing':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
    case 'returned':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
    case 'refunded':
      return 'bg-red-500/10 text-red-600 dark:text-red-400';
    case 'cancelled':
      return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function formatDate(d: string | null) {
  if (!d) return '--';
  return d;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(n);
}

export function BackendStateTab() {
  const { demoState, resetDemoState } = useDemoState();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Backend State</h2>
        </div>
        <Button variant="outline" size="sm" onClick={resetDemoState}>
          <RotateCcw className="size-3.5" />
          Reset Seed Data
        </Button>
      </div>

      <div>
        <div className="space-y-6 pr-2 pb-4">
          {/* Orders */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Package className="size-4" />
                Orders ({demoState.orders.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Return Deadline</TableHead>
                    <TableHead className="text-center">Refundable</TableHead>
                    <TableHead>Refunded At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demoState.orders.map((order) => {
                    const customer = demoState.customers.find(
                      (c) => c.id === order.customerId
                    );
                    return (
                      <TableRow key={order.id}>
                        <TableCell>
                          <code className="text-xs font-semibold">
                            {order.id}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <div>{customer?.name ?? order.customerId}</div>
                            <div className="text-muted-foreground">
                              {order.customerId}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            {order.items.map((item) => (
                              <div key={item.productId}>
                                {item.name} x{item.quantity}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCurrency(order.total)}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColor(order.status)}>
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {order.orderDate}
                        </TableCell>
                        <TableCell className="text-xs">
                          {order.returnDeadline}
                        </TableCell>
                        <TableCell className="text-center">
                          {order.isRefundable ? (
                            <CheckCircle2 className="mx-auto size-4 text-green-600 dark:text-green-400" />
                          ) : (
                            <XCircle className="mx-auto size-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDate(order.refundedAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Customers */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="size-4" />
                Customers ({demoState.customers.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-center">Verified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demoState.customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <code className="text-xs font-semibold">
                          {customer.id}
                        </code>
                      </TableCell>
                      <TableCell className="text-xs">{customer.name}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {customer.email}
                      </TableCell>
                      <TableCell className="text-center">
                        {customer.verified ? (
                          <CheckCircle2 className="mx-auto size-4 text-green-600 dark:text-green-400" />
                        ) : (
                          <XCircle className="mx-auto size-4 text-muted-foreground" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Refund Events */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Receipt className="size-4" />
                Refund Events ({demoState.refundEvents.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {demoState.refundEvents.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No refund events recorded yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Approved By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {demoState.refundEvents.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>
                          <code className="text-xs">{event.id}</code>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs font-semibold">
                            {event.orderId}
                          </code>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatCurrency(event.amount)}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs">
                          {event.reason}
                        </TableCell>
                        <TableCell className="text-xs">
                          {event.timestamp}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {event.approvedBy}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Audit Log */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="size-4" />
                Audit Log ({demoState.auditLog.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {demoState.auditLog.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No audit log entries yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Agent</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {demoState.auditLog.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <code className="text-xs">{entry.id}</code>
                        </TableCell>
                        <TableCell className="text-xs">
                          {entry.timestamp}
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          {entry.action}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {entry.agentId}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <pre className="max-w-[200px] truncate font-mono text-[10px]">
                            {JSON.stringify(entry.details)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
