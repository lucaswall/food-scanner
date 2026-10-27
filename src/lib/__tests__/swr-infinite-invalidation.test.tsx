import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import useSWRInfinite, { unstable_serialize } from "swr/infinite";
import { SWRConfig } from "swr";
import { invalidateFoodCaches } from "@/lib/swr";
import { useFoodListInvalidation } from "@/hooks/use-food-list-invalidation";

// Real SWR (no mock): verifies invalidateFoodCaches reaches useSWRInfinite lists.

let version = 1;
const fetcher = vi.fn(async (url: string) => ({ url, version }));

const getKey = (index: number, prev: unknown) => {
  if (index > 0 && !prev) return null;
  return `/api/food-history?page=${index}`;
};

// Default cache (what invalidateFoodCaches uses) but no cross-test request dedupe.
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0 }}>{children}</SWRConfig>
);

function useList() {
  const list = useSWRInfinite(getKey, fetcher);
  useFoodListInvalidation(getKey, list.mutate);
  return list;
}

describe("invalidateFoodCaches with useSWRInfinite", () => {
  beforeEach(() => {
    version = 1;
    fetcher.mockClear();
    const { cache } = SWRConfig.defaultValue;
    for (const key of Array.from(cache.keys())) cache.delete(key);
  });

  it("loading the next page does not refetch already-loaded pages", async () => {
    const { result } = renderHook(() => useList(), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]).toBeDefined());

    await act(async () => {
      await result.current.setSize(2);
    });
    await act(async () => {
      await result.current.setSize(3);
    });
    await waitFor(() => expect(result.current.data?.length).toBe(3));

    const page1Fetches = fetcher.mock.calls.filter(([url]) => url.endsWith("page=1")).length;
    expect(page1Fetches).toBe(1);
  });

  it("refetches every loaded page of a mounted infinite list", async () => {
    const { result } = renderHook(() => useList(), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]).toBeDefined());

    await act(async () => {
      await result.current.setSize(2);
    });
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(result.current.data?.every((p) => p.version === 1)).toBe(true);

    version = 2;
    await act(async () => {
      await invalidateFoodCaches();
    });

    await waitFor(() => {
      expect(result.current.data?.length).toBe(2);
      expect(result.current.data?.every((p) => p.version === 2)).toBe(true);
    });
  });

  it("drops cached pages of an unmounted list so it reloads fresh", async () => {
    const { result, unmount } = renderHook(() => useList(), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]).toBeDefined());
    unmount();

    const infiniteKey = unstable_serialize(getKey);
    expect(SWRConfig.defaultValue.cache.get(infiniteKey)).toBeDefined();

    await act(async () => {
      await invalidateFoodCaches();
    });

    expect(SWRConfig.defaultValue.cache.get(infiniteKey)).toBeUndefined();
  });
});
