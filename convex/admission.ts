import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const ADMISSION_WINDOW_MS = 900_000;
export const ADMISSION_PARTITIONS = 64;

// The receiver has already authenticated this random, server-issued nonce.
// Avoid bitwise operators: these are unsigned 32-bit values.
export function noncePartitions(nonce: string) {
  const primary = parseInt(nonce.slice(-8), 16) % ADMISSION_PARTITIONS;
  const alternate =
    (primary + 1 + (parseInt(nonce.slice(0, 8), 16) % 63)) %
    ADMISSION_PARTITIONS;
  return { primary, alternate };
}

export function broadCapacity(kind: "ip" | "session", partition: number) {
  return kind === "ip"
    ? 156 + (partition < 16 ? 1 : 0)
    : 46 + (partition < 56 ? 1 : 0);
}

export function partitionKey(base: string, partition: number) {
  return `${base}:p:${partition.toString().padStart(2, "0")}`;
}

export type Allowance = {
  key: string;
  row: Doc<"throttleCounters"> | null;
  partition: number;
};

export async function counterAllowance(
  ctx: MutationCtx,
  key: string,
  bucket: number,
  capacity: number,
  partition: number,
): Promise<Allowance | null> {
  const row = await ctx.db
    .query("throttleCounters")
    .withIndex("by_key_bucket", (q) => q.eq("key", key).eq("bucket", bucket))
    .unique();
  return row && row.count >= capacity ? null : { key, row, partition };
}

export async function broadAllowance(
  ctx: MutationCtx,
  base: string,
  bucket: number,
  kind: "ip" | "session",
  primary: number,
  alternate: number,
) {
  // No alternate read unless the primary is full. Each broad limit chooses
  // independently, with at most two indexed row reads and one increment.
  return (
    (await counterAllowance(
      ctx, partitionKey(base, primary), bucket, broadCapacity(kind, primary), primary,
    )) ??
    (await counterAllowance(
      ctx, partitionKey(base, alternate), bucket, broadCapacity(kind, alternate), alternate,
    ))
  );
}
