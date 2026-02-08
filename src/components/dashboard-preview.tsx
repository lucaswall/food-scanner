export function DashboardPreview() {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-6">
      {/* Blurred content */}
      <div className="blur-sm pointer-events-none select-none space-y-6">
        {/* Calorie ring mockup */}
        <div className="flex justify-center">
          <div
            className="w-32 h-32 rounded-full border-8 border-primary/30 flex items-center justify-center"
            data-testid="calorie-ring"
          >
            <div className="text-center">
              <p className="text-2xl font-bold text-muted-foreground">1,850</p>
              <p className="text-xs text-muted-foreground">calories</p>
            </div>
          </div>
        </div>
        {/* Macro bars */}
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Protein</span>
              <span>85g / 120g</span>
            </div>
            <div className="h-2 bg-muted rounded-full">
              <div className="h-2 bg-blue-500 rounded-full w-[70%]" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Carbs</span>
              <span>200g / 250g</span>
            </div>
            <div className="h-2 bg-muted rounded-full">
              <div className="h-2 bg-amber-500 rounded-full w-[80%]" />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Fat</span>
              <span>55g / 70g</span>
            </div>
            <div className="h-2 bg-muted rounded-full">
              <div className="h-2 bg-rose-500 rounded-full w-[78%]" />
            </div>
          </div>
        </div>
      </div>
      {/* Coming Soon overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-2xl font-bold text-muted-foreground/80 -rotate-12 select-none">
          Coming Soon
        </p>
      </div>
    </div>
  );
}
