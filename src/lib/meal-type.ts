export function getDefaultMealType(): number {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return 1; // Breakfast
  if (hour >= 10 && hour < 12) return 2; // Morning Snack
  if (hour >= 12 && hour < 14) return 3; // Lunch
  if (hour >= 14 && hour < 17) return 4; // Afternoon Snack
  if (hour >= 17 && hour < 21) return 5; // Dinner
  return 7; // Anytime
}

export function getLocalDateTime(): { date: string; time: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
}
