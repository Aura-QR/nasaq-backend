/**
 * How a discount turns into riyals.
 *
 * A discount is either a percentage of the fee or a fixed amount. The school
 * that asked for this gives returning students 500 riyals off: as a
 * percentage that is 5.56% of a 9,000 fee, 4.55% of 11,000 and 3.85% of
 * 13,000, so no single percentage is right. A fixed discount stays 500 on
 * every grade, and the percentage shown beside it is worked out from the fee.
 *
 * Tuition may carry several discounts at once (siblings and returning
 * student); they add up, and together never exceed the fee.
 */

export type DiscountType = 'percentage' | 'fixed';
export const DISCOUNT_TYPES: DiscountType[] = ['percentage', 'fixed'];

/** Riyals off `base` for one discount. */
export function discountAmountFor(type: DiscountType | string | undefined, percentage: number, amount: number | null | undefined, base: number): number {
  const fee = Math.max(0, Number(base) || 0);
  if (type === 'fixed') return Math.min(fee, Math.max(0, Math.round(Number(amount) || 0)));
  return Math.min(fee, Math.round((fee * (Number(percentage) || 0)) / 100));
}

/** The share of `base` that `amount` is, to two decimals: what the page shows. */
export function percentOf(amount: number, base: number): number {
  return base > 0 ? Math.round((amount / base) * 10000) / 100 : 0;
}

/** A discount as written onto a student's fee. */
export function entryFrom(
  source: { _id?: any; name: string; type?: string; percentage?: number; amount?: number | null },
  base: number,
  extra: { reason?: string; custom?: boolean; appliedBy?: any } = {},
) {
  const type: DiscountType = source.type === 'fixed' ? 'fixed' : 'percentage';
  const discountAmount = discountAmountFor(type, source.percentage ?? 0, source.amount, base);
  return {
    discountId: source._id ?? null,
    name: source.name,
    type,
    percentage: type === 'fixed' ? percentOf(discountAmount, base) : Number(source.percentage) || 0,
    amount: type === 'fixed' ? Math.round(Number(source.amount) || 0) : null,
    discountAmount,
    reason: extra.reason ?? '',
    custom: Boolean(extra.custom),
    appliedBy: extra.appliedBy ?? null,
    appliedAt: new Date(),
  };
}

/**
 * The tuition's discounts, including one applied before tuition could carry
 * several — that one lives only in `tuition.discount` and is read as a
 * percentage discount.
 */
export function tuitionEntries(tuition: any): any[] {
  if (Array.isArray(tuition?.discounts) && tuition.discounts.length) return tuition.discounts;
  const legacy = tuition?.discount;
  if (!legacy) return [];
  const plain = typeof legacy.toObject === 'function' ? legacy.toObject() : { ...legacy };
  return [{ type: 'percentage', amount: null, reason: '', custom: false, ...plain }];
}

/**
 * Re-price every tuition discount against the current gross fee and write the
 * totals back: `discounts` (each one), `discount` (their sum, kept for every
 * screen that reads a single discount) and `netFee`.
 *
 * Installments are not touched here; the caller rebalances.
 */
export function recomputeTuitionDiscounts(tuition: any): void {
  const gross = Number(tuition.grossFee) || Number(tuition.fee) || 0;
  const entries = tuitionEntries(tuition).map((entry: any) => {
    const e = typeof entry.toObject === 'function' ? entry.toObject() : { ...entry };
    e.discountAmount = discountAmountFor(e.type, e.percentage, e.amount, gross);
    if (e.type === 'fixed') e.percentage = percentOf(e.discountAmount, gross);
    return e;
  });
  const total = Math.min(gross, entries.reduce((sum, e) => sum + (Number(e.discountAmount) || 0), 0));
  tuition.discounts = entries;
  tuition.discount = entries.length
    ? {
        discountId: entries.length === 1 ? entries[0].discountId ?? null : null,
        name: entries.map((e) => e.name).join(' + '),
        type: entries.length === 1 ? entries[0].type : 'fixed',
        percentage: percentOf(total, gross),
        amount: entries.length === 1 ? entries[0].amount ?? null : total,
        discountAmount: total,
      }
    : null;
  tuition.netFee = gross - total;
}
