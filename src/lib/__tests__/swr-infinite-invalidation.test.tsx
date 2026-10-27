import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import useSWRInfinite from "swr/infinite";
import { invalidateFoodCaches } from "@/lib/swr";

// Real SWR (no mock): verifies invalidateFoodCaches reaches useSWRInfinite lists.

let version = 1;
const fetcher = vi.fn(async (url: string) => ({ url, version }));

function useList() {
  return useSWRInfinite(
    (index: number, prev: unknown) => {
      if (index > 0 && !prev) return null;
      return `/api/food-history?page=${index}`;
    },
    fetcher,
    { revalidateAll: true },
  );
}

describe("invalidateFoodCaches with useSWRInfinite", () => {
  beforeEach(() => {
    version = 1;
    fetcher.mockClear();
  });

  it("refetches every loaded page of a mounted infinite list", async () => {
    const { result } = renderHook(() => useList());
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
});
