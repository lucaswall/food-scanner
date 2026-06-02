import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NutritionGoals } from "@/types";

export type GoalBlockedReason = NonNullable<NutritionGoals["reason"]>;

const REASON_MESSAGES: Record<GoalBlockedReason, string> = {
  goals_not_set: "Set up your daily goals in Settings to see your targets.",
  no_weight: "Log your weight in Google Health to enable targets.",
  sex_unset: "Set your biological sex in Settings to enable targets.",
  scope_mismatch: "Reconnect Google Health to enable targets.",
  invalid_profile:
    "Your Google Health profile has invalid values — update your profile in Google Health.",
};

interface GoalsSetupBannerProps {
  /** Blocked reason from the nutrition-goals API response. */
  reason: GoalBlockedReason;
}

/**
 * Dumb banner shown on the dashboard whenever goals.status === "blocked".
 * Receives the blocked reason as a prop; performs no own data fetching.
 * Matches the amber/warning palette from HealthStatusBanner (FOO-1046).
 */
export function GoalsSetupBanner({ reason }: GoalsSetupBannerProps) {
  const message =
    REASON_MESSAGES[reason] ??
    "Set up your daily goals in Settings to see your targets.";

  return (
    <Alert variant="default" className="border-warning bg-warning/10">
      <AlertCircle className="h-4 w-4 text-warning" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span className="text-sm text-foreground">{message}</span>
        <Button
          variant="outline"
          size="sm"
          asChild
          className="shrink-0 min-h-[44px]"
        >
          <Link href="/settings">Open Settings</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
