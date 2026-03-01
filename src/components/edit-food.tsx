"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { FoodChat } from "@/components/food-chat";
import { FoodLogConfirmation } from "@/components/food-log-confirmation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import type { FoodAnalysis, FoodLogEntryDetail, FoodLogResponse } from "@/types";

interface EditFoodProps {
  entryId: string;
}

export function EditFood({ entryId }: EditFoodProps) {
  const router = useRouter();
  const { data, error, isLoading } = useSWR<FoodLogEntryDetail>(
    `/api/food-history/${entryId}`,
    apiFetcher,
  );

  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [loggedAnalysis, setLoggedAnalysis] = useState<FoodAnalysis | undefined>();
  const [loggedMealTypeId, setLoggedMealTypeId] = useState<number | undefined>();

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto p-4">
        <p className="text-center text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-6">
        <Button
          onClick={() => router.back()}
          variant="ghost"
          className="min-h-[44px]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex flex-col items-center gap-4 p-6 bg-destructive/10 border border-destructive/20 rounded-lg text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm text-destructive">
            Something went wrong loading this food entry.
          </p>
        </div>
      </div>
    );
  }

  if (logResponse) {
    return (
      <div className="space-y-6">
        <FoodLogConfirmation
          response={logResponse}
          foodName={loggedAnalysis?.food_name ?? data.foodName}
          analysis={loggedAnalysis}
          mealTypeId={loggedMealTypeId}
          isEdit
        />
      </div>
    );
  }

  return (
    <FoodChat
      mode="edit"
      editEntry={data}
      onLogged={(response, analysis, mealTypeId) => {
        setLoggedAnalysis(analysis);
        setLoggedMealTypeId(mealTypeId);
        setLogResponse(response);
      }}
    />
  );
}
