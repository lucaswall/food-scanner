"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FoodChat } from "@/components/food-chat";
import { FoodLogConfirmation } from "@/components/food-log-confirmation";
import type { FoodAnalysis, FoodLogResponse } from "@/types";

export function ChatPageClient() {
  const router = useRouter();
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [loggedAnalysis, setLoggedAnalysis] = useState<FoodAnalysis | null>(null);
  const [loggedMealTypeId, setLoggedMealTypeId] = useState<number | null>(null);

  if (logResponse && loggedAnalysis) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <FoodLogConfirmation
          response={logResponse}
          foodName={loggedAnalysis.food_name}
          analysis={loggedAnalysis}
          mealTypeId={loggedMealTypeId ?? undefined}
        />
      </div>
    );
  }

  return (
    <FoodChat
      title="Chat"
      onClose={() => router.push("/app")}
      onLogged={(response, analysis, mealTypeId) => {
        setLogResponse(response);
        setLoggedAnalysis(analysis);
        setLoggedMealTypeId(mealTypeId);
      }}
    />
  );
}
