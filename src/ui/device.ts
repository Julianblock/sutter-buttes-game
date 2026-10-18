const params = new URLSearchParams(location.search);
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const hover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;

/** Phones and tablets: show on-screen controls. `?touch` forces it on a desktop. */
export const isTouch = params.has('touch') || (coarse && !hover) || (navigator.maxTouchPoints > 0 && !hover);

/** Mobile GPUs get a lighter scene: lower resolution, fewer trees and grass blades. */
export const lowPower = isTouch && !params.has('hq');
