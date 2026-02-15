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

  if (logResponse && loggedAnalysis) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <FoodLogConfirmation
          response={logResponse}
          foodName={loggedAnalysis.food_name}
          analysis={loggedAnalysis}
        />
      </div>
    );
  }

  return (
    <FoodChat
      title="Chat"
      onClose={() => router.push("/app")}
      onLogged={(response, analysis) => {
        setLogResponse(response);
        setLoggedAnalysis(analysis);
      }}
    />
  );
}
