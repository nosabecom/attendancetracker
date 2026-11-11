export function legacyRequestGate(write = false) {
  const backend = process.env.NEXT_PUBLIC_ATTENDANCE_BACKEND ?? "blob";
  if (backend === "convex") return Response.json(
    { error: "This page has been updated. Reload it to continue." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
  if (backend !== "blob" || (write && process.env.ATTENDANCE_BLOB_WRITES_DISABLED === "1"))
    return Response.json({ error: "Attendance is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  return null;
}
