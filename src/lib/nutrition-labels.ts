import type { NutritionLabel } from "@/types";

export async function getAllLabels(userId: string, query?: string): Promise<NutritionLabel[]> {
  void userId;
  void query;
  throw new Error("Not implemented");
}

export async function deleteLabel(userId: string, labelId: number): Promise<boolean> {
  void userId;
  void labelId;
  throw new Error("Not implemented");
}
