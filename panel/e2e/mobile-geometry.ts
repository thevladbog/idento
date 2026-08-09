export const MINIMUM_TOUCH_TARGET_CSS_PX = 44;

const SUBPIXEL_ROUNDING_TOLERANCE_CSS_PX = 0.001;

export function meetsMinimumTouchTarget(size: number): boolean {
  return size >= MINIMUM_TOUCH_TARGET_CSS_PX - SUBPIXEL_ROUNDING_TOLERANCE_CSS_PX;
}
