import { useEffect } from "react";
import { unstable_serialize, type SWRInfiniteKeyLoader } from "swr/infinite";
import { registerFoodList } from "@/lib/swr";

/**
 * Lets `invalidateFoodCaches` refresh every loaded page of this useSWRInfinite
 * list (via its bound `mutate()`), instead of the list running `revalidateAll`
 * on every page load.
 */
export function useFoodListInvalidation(
  getKey: SWRInfiniteKeyLoader,
  mutate: () => Promise<unknown>,
): void {
  useEffect(() => {
    const infiniteKey = unstable_serialize(getKey);
    if (!infiniteKey) return;
    return registerFoodList(infiniteKey, () => mutate());
  }, [getKey, mutate]);
}
