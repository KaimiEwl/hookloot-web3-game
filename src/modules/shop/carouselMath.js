export function getSignedCarouselOffset(index, activeIndex, total) {
  let diff = index - activeIndex;
  const half = Math.floor(total / 2);
  if (diff > half) diff -= total;
  if (diff < -half) diff += total;
  return diff;
}

export function getSwipeAxisLock(pointerType) {
  if (pointerType === 'mouse') return 12;
  if (pointerType === 'pen') return 10;
  return 8;
}

export function getSwipeThreshold(pointerType) {
  if (pointerType === 'mouse') return 34;
  if (pointerType === 'pen') return 30;
  return 24;
}
