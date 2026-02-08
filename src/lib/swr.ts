export async function apiFetcher(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${response.status}`);
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.error?.message || "Failed to load");
  return result.data;
}
