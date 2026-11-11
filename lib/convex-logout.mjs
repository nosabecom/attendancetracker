// The pinned managed client's signOut swallows transport failures. Confirm
// server revocation first, then reset its in-memory state with a clean page.
export async function verifiedLogout({ fetcher = fetch, navigate = () => window.location.replace("/") } = {}) {
  const response = await fetcher("/api/convex-auth", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "auth:signOut" }),
  });
  if (!response.ok) throw new Error("Unable to sign out. Please try again.");
  navigate();
}
