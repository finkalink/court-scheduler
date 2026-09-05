export function buildVenmoPaymentUrl({
  handle,
  amountCents,
  note,
}: {
  handle: string;
  amountCents: number;
  note: string;
}): string {
  const params = new URLSearchParams({
    txn: "pay",
    recipients: handle,
    amount: (amountCents / 100).toFixed(2),
    note,
  });
  return `https://venmo.com/?${params.toString()}`;
}
