export function add(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) throw new TypeError("finite numbers are required");
  return left + right;
}
