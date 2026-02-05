/**
 * Haptic feedback utilities using the Vibration API.
 * Provides vibration patterns for success and error states on mobile devices.
 * Gracefully degrades on devices without vibration support.
 */

/**
 * Vibrate for success feedback (200ms single vibration).
 * Used after successful actions like logging food to Fitbit.
 */
export function vibrateSuccess(): void {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(200);
  }
}

/**
 * Vibrate for error feedback (pulse pattern: 100ms on, 50ms off, 100ms on).
 * Used for error states and failed operations.
 */
export function vibrateError(): void {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate([100, 50, 100]);
  }
}
